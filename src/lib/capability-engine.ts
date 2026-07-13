/**
 * Reactive capability engine for the SDK Explorer.
 *
 * Pure, framework-free logic that decides — from the live EHR context — which
 * catalog operations can run and with what inputs. The React layer feeds it the
 * manifest + a context store and reacts to its verdicts; keeping the decision
 * logic here (no SDK, no React) makes it unit-testable.
 *
 * The core behaviour: the moment the context surfaces the id inputs a read
 * operation declares (metadata.idParameterNames), that read becomes `ready` and
 * the UI fires it immediately. Writes never auto-fire — their payload can't be
 * synthesised from context — so they surface `armed` and run on explicit intent.
 */

import type { AppManifest, ContextData } from '@vimconnect/app-sdk';

type OperationEntry = NonNullable<AppManifest['operations']>[number];

export type OperationKind = 'getById' | 'search' | 'updateById' | 'create';

export interface RunnableOp {
  /** Stable identity, `${namespace}.${method}` — used as the React/dedup key. */
  key: string;
  namespace: string;
  method: string;
  signature: string;
  kind: OperationKind;
  disruptive: boolean;
  /** Id inputs this op needs, e.g. ['patientId']. Empty ⇒ resolves from current context. */
  idParameterNames: string[];
  /** getById/search are non-disruptive reads and the only ops that auto-fire. */
  isRead: boolean;
}

/** One entity currently in the EHR context, keyed by entity type in the store. */
export interface ContextEntry {
  entityType: string;
  id: string | null;
  data: ContextData;
  at: string;
}

export type ContextStore = Record<string, ContextEntry>;

export type BindingStatus = 'ready' | 'waiting';

export interface Binding {
  status: BindingStatus;
  /** Argument object to pass to the SDK method (id params for id ops, {} otherwise). */
  args: Record<string, string>;
  resolvedIds: Record<string, string>;
  /** Entity types whose context is still missing (why the op is waiting). */
  waitingOn: string[];
  /** Changes whenever the bound inputs change → drives re-fire and dedup. */
  fingerprint: string;
}

function idParameterNamesOf(op: OperationEntry): string[] {
  const meta = op.metadata;
  if (meta.type === 'getById' || meta.type === 'updateById') {
    return meta.idParameterNames ?? [];
  }
  return [];
}

/**
 * Map an id parameter name to the entity type that carries it, e.g.
 * 'patientId' → 'patient', 'encounterId' → 'encounter'. The collection names
 * id params after their owning entity, so stripping the 'Id' suffix resolves
 * which context entry supplies the value.
 */
export function entityForIdParam(param: string): string {
  const base = param.endsWith('Id') ? param.slice(0, -2) : param;
  return base.toLowerCase();
}

/**
 * Pull an entity id out of a context payload. The id sits at the top level of
 * ContextData; older shapes carry it on `identifier` or under
 * `fields.identifiers`, so we fall back defensively.
 */
export function extractEntityId(data: ContextData | null | undefined): string | null {
  if (!data) return null;
  if (data.id) return String(data.id);
  if (data.identifier && 'id' in data.identifier && data.identifier.id) {
    return String(data.identifier.id);
  }
  const identifiers = (data.fields as Record<string, unknown> | undefined)?.identifiers;
  if (identifiers && typeof identifiers === 'object') {
    for (const value of Object.values(identifiers as Record<string, unknown>)) {
      if (typeof value === 'string' && value) return value;
    }
  }
  return null;
}

function toRunnableOp(op: OperationEntry): RunnableOp {
  const isRead = op.operationType === 'getById' || op.operationType === 'search';
  return {
    key: `${op.sdkNamespace}.${op.sdkMethod}`,
    namespace: op.sdkNamespace,
    method: op.sdkMethod,
    signature: op.sdkSignature,
    kind: op.operationType,
    disruptive: op.disruptive,
    idParameterNames: idParameterNamesOf(op),
    isRead,
  };
}

export function buildRunnableOps(manifest: AppManifest | null): RunnableOp[] {
  return (manifest?.operations ?? []).filter((op) => op.available).map(toRunnableOp);
}

/**
 * Catalog operations the current EHR does NOT implement (`available: false`) —
 * the capability gaps surfaced alongside the runnable ops so the missing
 * surface is as visible as the working one.
 */
export function buildMissingOps(manifest: AppManifest | null): RunnableOp[] {
  return (manifest?.operations ?? []).filter((op) => !op.available).map(toRunnableOp);
}

/** Map of entity type → all field names the manifest declares for it. */
export function entityFieldsByType(manifest: AppManifest | null): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entity of manifest?.supportedEntities ?? []) {
    map[entity.type] = entity.fields ?? [];
  }
  return map;
}

/** A plain (non-array) object suitable for field-completeness, else null. */
export function asEntityObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

export interface FieldCompleteness {
  total: number;
  present: string[];
  missing: string[];
}

/**
 * Split an entity's declared fields into those populated in the payload and
 * those absent/empty — the extraction-gap view for a received entity.
 */
export function computeCompleteness(allFields: string[], value: Record<string, unknown> | null): FieldCompleteness {
  const present: string[] = [];
  const missing: string[] = [];
  for (const field of allFields) {
    if (hasValue(value?.[field])) present.push(field);
    else missing.push(field);
  }
  return { total: allFields.length, present, missing };
}

/**
 * The received entity augmented with every declared field — missing ones added
 * as null — so the copyable view shows the entity's full shape, gaps included.
 */
export function withMissingFields(allFields: string[], value: Record<string, unknown> | null): Record<string, unknown> {
  const template: Record<string, unknown> = {};
  for (const field of allFields) template[field] = null;
  return { ...template, ...(value ?? {}) };
}

/**
 * Resolve an operation's inputs against the current context store.
 * - Ops with id params are ready once every id resolves from context.
 * - Ops with no id params resolve their entity from the current context, so
 *   they are ready once their namespace entity is present.
 */
export function resolveBinding(op: RunnableOp, store: ContextStore): Binding {
  if (op.idParameterNames.length > 0) {
    const resolvedIds: Record<string, string> = {};
    const waitingOn: string[] = [];
    for (const param of op.idParameterNames) {
      const entity = entityForIdParam(param);
      const id = store[entity]?.id ?? null;
      if (id) resolvedIds[param] = id;
      else waitingOn.push(entity);
    }
    const ready = waitingOn.length === 0;
    return {
      status: ready ? 'ready' : 'waiting',
      args: ready ? { ...resolvedIds } : {},
      resolvedIds,
      waitingOn,
      fingerprint: JSON.stringify(resolvedIds),
    };
  }

  const entry = store[op.namespace];
  const present = !!entry;
  return {
    status: present ? 'ready' : 'waiting',
    args: {},
    resolvedIds: {},
    waitingOn: present ? [] : [op.namespace],
    fingerprint: entry?.id ? `ctx:${op.namespace}:${entry.id}` : present ? `ctx:${op.namespace}:present` : '',
  };
}

/**
 * Decide whether a read should auto-fire now. Only non-disruptive reads fire
 * automatically; disruptive reads require the `autoRunDisruptive` opt-in. Dedup
 * against `lastFingerprint` so identical inputs fire once and only re-fire when
 * the bound context changes.
 */
export function shouldFire(
  op: RunnableOp,
  binding: Binding,
  options: { autoRunDisruptive: boolean; lastFingerprint: string | undefined },
): boolean {
  if (!op.isRead) return false;
  if (binding.status !== 'ready') return false;
  if (op.disruptive && !options.autoRunDisruptive) return false;
  return binding.fingerprint !== options.lastFingerprint;
}
