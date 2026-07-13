import { describe, it, expect } from 'vitest';
import type { AppManifest, ContextData } from '@vimconnect/app-sdk';
import {
  buildMissingOps,
  buildRunnableOps,
  computeCompleteness,
  entityFieldsByType,
  entityForIdParam,
  extractEntityId,
  resolveBinding,
  shouldFire,
  withMissingFields,
  type ContextStore,
  type RunnableOp,
} from './capability-engine';

describe('buildRunnableOps', () => {
  it('lists only operations the current EHR implements', () => {
    const ops = buildRunnableOps(
      manifest([
        getById('patient', 'getPatient', ['patientId'], { available: true }),
        getById('patient', 'getSecret', ['patientId'], { available: false }),
      ]),
    );

    expect(ops.map((o) => o.key)).toEqual(['patient.getPatient']);
  });

  it('marks getById and search as reads, and writes as non-reads', () => {
    const ops = buildRunnableOps(
      manifest([
        getById('patient', 'getPatient', ['patientId']),
        search('patient', 'searchPatients'),
        updateById('encounter', 'updateProcedureCodes', ['encounterId']),
      ]),
    );

    expect(ops.find((o) => o.key === 'patient.getPatient')?.isRead).toBe(true);
    expect(ops.find((o) => o.key === 'patient.searchPatients')?.isRead).toBe(true);
    expect(ops.find((o) => o.key === 'encounter.updateProcedureCodes')?.isRead).toBe(false);
  });

  it('extracts id parameter names from the operation metadata', () => {
    const ops = buildRunnableOps(
      manifest([updateById('encounter', 'updateProcedureCodes', ['encounterId'])]),
    );

    expect(ops[0].idParameterNames).toEqual(['encounterId']);
  });
});

describe('entityForIdParam', () => {
  it('maps an id parameter to its owning entity type', () => {
    expect(entityForIdParam('patientId')).toBe('patient');
    expect(entityForIdParam('encounterId')).toBe('encounter');
  });

  it('lowercases a parameter with no Id suffix', () => {
    expect(entityForIdParam('Referral')).toBe('referral');
  });
});

describe('extractEntityId', () => {
  it('reads the id from the top level of the context payload', () => {
    expect(extractEntityId(context('patient', 'p-1'))).toBe('p-1');
  });

  it('falls back to an identifier under fields when the top-level id is empty', () => {
    const data = context('patient', '');
    data.fields = { identifiers: { ehrPatientId: 'ehr-9' } };
    expect(extractEntityId(data)).toBe('ehr-9');
  });

  it('returns null when nothing carries an id', () => {
    expect(extractEntityId(undefined)).toBeNull();
  });
});

describe('resolveBinding', () => {
  const getPatient = op({ key: 'patient.getPatient', idParameterNames: ['patientId'] });

  it('waits while the required context is missing', () => {
    const binding = resolveBinding(getPatient, {});
    expect(binding.status).toBe('waiting');
    expect(binding.waitingOn).toEqual(['patient']);
  });

  it('becomes ready and binds the id once the context arrives', () => {
    const binding = resolveBinding(getPatient, store(context('patient', 'p-1')));
    expect(binding.status).toBe('ready');
    expect(binding.args).toEqual({ patientId: 'p-1' });
  });

  it('resolves a zero-parameter op from its namespace entity in context', () => {
    const listInsurances = op({ key: 'patient.getInsurances', namespace: 'patient', idParameterNames: [] });
    expect(resolveBinding(listInsurances, {}).status).toBe('waiting');
    expect(resolveBinding(listInsurances, store(context('patient', 'p-1'))).status).toBe('ready');
  });
});

describe('shouldFire', () => {
  const getPatient = op({ key: 'patient.getPatient', idParameterNames: ['patientId'] });
  const ready = resolveBinding(getPatient, store(context('patient', 'p-1')));

  it('fires a ready read whose inputs have not been run yet', () => {
    expect(shouldFire(getPatient, ready, { autoRunDisruptive: false, lastFingerprint: undefined })).toBe(true);
  });

  it('does not re-fire when the bound inputs are unchanged', () => {
    expect(shouldFire(getPatient, ready, { autoRunDisruptive: false, lastFingerprint: ready.fingerprint })).toBe(false);
  });

  it('re-fires when the bound patient changes', () => {
    const next = resolveBinding(getPatient, store(context('patient', 'p-2')));
    expect(shouldFire(getPatient, next, { autoRunDisruptive: false, lastFingerprint: ready.fingerprint })).toBe(true);
  });

  it('never auto-fires a write', () => {
    const write = op({ key: 'encounter.update', idParameterNames: ['encounterId'], isRead: false });
    const writeReady = resolveBinding(write, store(context('encounter', 'e-1')));
    expect(shouldFire(write, writeReady, { autoRunDisruptive: true, lastFingerprint: undefined })).toBe(false);
  });

  it('gates a disruptive read behind the opt-in', () => {
    const disruptive = op({ key: 'patient.getPatient', idParameterNames: ['patientId'], disruptive: true });
    expect(shouldFire(disruptive, ready, { autoRunDisruptive: false, lastFingerprint: undefined })).toBe(false);
    expect(shouldFire(disruptive, ready, { autoRunDisruptive: true, lastFingerprint: undefined })).toBe(true);
  });
});

describe('buildMissingOps', () => {
  it('lists only operations the EHR does not implement', () => {
    const missing = buildMissingOps(
      manifest([
        getById('patient', 'getPatient', ['patientId'], { available: true }),
        getById('patient', 'getSecret', ['patientId'], { available: false }),
        updateById('encounter', 'writeNotes', ['encounterId'], { available: false }),
      ]),
    );

    expect(missing.map((o) => o.key)).toEqual(['patient.getSecret', 'encounter.writeNotes']);
    expect(missing.find((o) => o.key === 'encounter.writeNotes')?.isRead).toBe(false);
  });
});

describe('entityFieldsByType', () => {
  it('maps each entity type to its declared field names', () => {
    const map = entityFieldsByType(manifest([], [entity('patient', ['demographics', 'address'])]));
    expect(map.patient).toEqual(['demographics', 'address']);
  });
});

describe('computeCompleteness', () => {
  it('splits declared fields into populated vs absent/empty', () => {
    const comp = computeCompleteness(['a', 'b', 'c', 'd'], { a: 'x', b: [], c: null });
    expect(comp.present).toEqual(['a']);
    expect(comp.missing).toEqual(['b', 'c', 'd']);
    expect(comp.total).toBe(4);
  });
});

describe('withMissingFields', () => {
  it('adds every declared field, missing ones as null, keeping received values', () => {
    expect(withMissingFields(['a', 'b', 'c'], { a: 1 })).toEqual({ a: 1, b: null, c: null });
  });
});

// ── Test fixtures ────────────────────────────────────────────────────────────

type OpEntry = NonNullable<AppManifest['operations']>[number];
type EntityEntry = AppManifest['supportedEntities'][number];

function manifest(operations: OpEntry[], supportedEntities: EntityEntry[] = []): AppManifest {
  return {
    version: 'test',
    apiVersion: '3.0',
    supportedEvents: [],
    supportedContexts: [],
    supportedEntities,
    typeDefinitions: [],
    features: [],
    operations,
  };
}

function entity(type: string, fields: string[]): EntityEntry {
  return { type, fields, since: '1.0' };
}

function getById(
  namespace: string,
  method: string,
  idParameterNames: string[],
  overrides: Partial<OpEntry> = {},
): OpEntry {
  return {
    catalogEntryId: `${namespace}.${method}`,
    operationType: 'getById',
    entityTypeId: namespace,
    sdkNamespace: namespace,
    sdkMethod: method,
    sdkSignature: `${namespace}.${method}(...)`,
    available: true,
    disruptive: false,
    metadata: { type: 'getById', targetField: method, idParameterNames },
    ...overrides,
  };
}

function search(namespace: string, method: string, overrides: Partial<OpEntry> = {}): OpEntry {
  return {
    catalogEntryId: `${namespace}.${method}`,
    operationType: 'search',
    entityTypeId: namespace,
    sdkNamespace: namespace,
    sdkMethod: method,
    sdkSignature: `${namespace}.${method}(...)`,
    available: true,
    disruptive: false,
    metadata: { type: 'search', supportsQuery: true, filterFields: [], maxResults: 20 },
    ...overrides,
  };
}

function updateById(
  namespace: string,
  method: string,
  idParameterNames: string[],
  overrides: Partial<OpEntry> = {},
): OpEntry {
  return {
    catalogEntryId: `${namespace}.${method}`,
    operationType: 'updateById',
    entityTypeId: namespace,
    sdkNamespace: namespace,
    sdkMethod: method,
    sdkSignature: `${namespace}.${method}(...)`,
    available: true,
    disruptive: true,
    metadata: { type: 'updateById', updateableFields: [], idParameterNames },
    ...overrides,
  };
}

function context(type: string, id: string): ContextData {
  return { id, type, identifier: { type: 'existing', id }, fields: {} };
}

function store(...entries: ContextData[]): ContextStore {
  const out: ContextStore = {};
  for (const data of entries) {
    out[data.type] = { entityType: data.type, id: extractEntityId(data), data, at: 'now' };
  }
  return out;
}

function op(partial: Partial<RunnableOp> & { key: string }): RunnableOp {
  const [namespace, method] = partial.key.split('.');
  return {
    namespace,
    method,
    signature: `${partial.key}(...)`,
    kind: 'getById',
    disruptive: false,
    idParameterNames: [],
    isRead: true,
    ...partial,
  };
}
