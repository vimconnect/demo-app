'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { initVimSDK, type ContextKey, type EntityTypeMap, type Patient } from '@vimconnect/app-sdk';
import { PatientHeader } from './components/PatientHeader';
import { FilterBar } from './components/FilterBar';
import { GapCard } from './components/GapCard';
import { EmptyState } from './components/EmptyState';
import { MOCK_GAPS } from './data/mockGaps';
import { DiagnosisGap, GapFilter, GapWithStatus, Insurance, PatientData } from './types';
import styles from './care-insights.module.css';
import type { VimSDK, AppManifest } from '@vimconnect/app-sdk';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ManifestContext {
  entityType?: string;
  type?: string;
  contextKey?: string;
  key?: string;
}

/**
 * Returns all context keys in the manifest for a given entity type.
 * Multiple keys can exist for the same entity type across different event types
 * (e.g. 'chart_open:patient' and 'encounter_open:patient'). Subscribing to all
 * of them ensures the init event fires regardless of which event stored the context.
 */
function findAllContextKeys(manifest: AppManifest, entityType: keyof EntityTypeMap): ContextKey[] {
  const contexts: ManifestContext[] = manifest?.supportedContexts || [];
  return contexts
    .filter((c) => c.entityType === entityType || c.type === entityType)
    .map((c) => c.contextKey ?? c.key)
    .filter(Boolean) as ContextKey[];
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonView() {
  return (
    <div className={styles.app}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonHeaderName} />
        <div className={styles.skeletonHeaderMeta} />
      </div>
      <div className={styles.skeletonBanner}>
        <div className={`${styles.skeletonBase} ${styles.skeletonBannerText}`} />
      </div>
      <div className={styles.skeletonFilterBar}>
        {[60, 80, 70].map((w, i) => (
          <div key={i} className={`${styles.skeletonBase} ${styles.skeletonPill}`} style={{ width: w }} />
        ))}
      </div>
      <div className={styles.gapsList}>
        {[0, 1, 2].map(i => (
          <div key={i} className={styles.skeletonCard}>
            <div className={`${styles.skeletonBase} ${styles.skeletonCardIcon}`} />
            <div className={styles.skeletonCardContent}>
              <div className={`${styles.skeletonBase} ${styles.skeletonCardTitle}`} />
              <div className={`${styles.skeletonBase} ${styles.skeletonCardSubtitle}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main content ─────────────────────────────────────────────────────────────

function CareInsightsContent() {
  const searchParams = useSearchParams();

  // Auth / SDK state
  const [sdkStatus, setSdkStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sdkError, setSdkError] = useState<string | null>(null);
  const sdkRef = useRef<VimSDK | null>(null);
  const initializingRef = useRef(false);
  const initializedRef = useRef(false);

  // Clinical state
  const [patient, setPatient] = useState<PatientData | null>(null);
  const patientRef = useRef<PatientData | null>(null);
  const [patientLoading, setPatientLoading] = useState(false);
  const [hasEncounter, setHasEncounter] = useState(false);
  const [gaps, setGaps] = useState<GapWithStatus[]>([]);
  const gapsRef = useRef<GapWithStatus[]>([]);
  const lastEncounterContextRef = useRef<any>(null);
  const patientLoadingRef = useRef(false);
  const [activeFilter, setActiveFilter] = useState<GapFilter>('all');

  // ── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    if (initializedRef.current || initializingRef.current) return;
    initializingRef.current = true;
    initializeApp();
  }, []);

  async function initializeApp() {
    try {
      const code = searchParams.get('code');
      const stateParam = searchParams.get('state');

      if (!code || !stateParam) throw new Error('Missing OAuth parameters');

      // CSRF validation
      const [launchId, csrfToken] = stateParam.split(':');
      if (!launchId || !csrfToken) throw new Error('Invalid state parameter format');

      const flowKey = `oauth_state_${launchId}`;
      const storedToken = sessionStorage.getItem(flowKey);
      if (csrfToken !== storedToken) throw new Error('CSRF validation failed');
      sessionStorage.removeItem(flowKey);

      // Exchange code → access token (uses CI-specific credentials)
      const tokenRes = await fetch('/care-insights/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error_description || 'Token exchange failed');
      }

      const { access_token } = await tokenRes.json();
      // Persist token so the offscreen worker page can init SDK without re-doing OAuth
      localStorage.setItem('care_insights_access_token', access_token);
      initializedRef.current = true;

      // Initialize SDK via npm import
      const sdk = await initVimSDK({ accessToken: access_token, debug: true });
      sdkRef.current = sdk;

      // Start disabled; will enable when patient arrives
      sdk.hub.setActivationStatus('DISABLED');
      sdk.hub.setTooltipText('Waiting for patient...');

      // Set up EHR subscriptions
      setupSubscriptions(sdk);

      // ── Worker App integration (Phase 1) ─────────────────────────────────────
      // Subscribe to workerState updates written by the offscreen Worker App.
      // The Worker App writes patient summaries and event data via workerState.write().
      if (typeof sdk.workerState?.on === 'function') {
        sdk.workerState.on('last_event', (prev: any, curr: any) => {
          if (curr != null) {
            console.log('[care-insights] Worker App last event:', curr);
          }
        });
      }

      // Listen for app open to check if there's a launchPayload from a notification click.
      if (typeof sdk.hub?.appState?.subscribe === 'function') {
        sdk.hub.appState.subscribe('appOpenStatus', (status: any) => {
          if (status.isAppOpen && typeof sdk.getLaunchContext === 'function') {
            const ctx = sdk.getLaunchContext();
            if (ctx != null) {
              console.log('[care-insights] Opened via notification, launchPayload:', ctx);
            }
          }
        });
      }

      setSdkStatus('ready');

      // Hydrate encounter state collected by the offscreen worker while the app was closed.
      // Only a boolean flag is stored (no PHI) — full patient/encounter context is delivered
      // via the SDK's on-demand init event when setupSubscriptions registers its onChange handlers.
      const storedContext = localStorage.getItem('care_insights_offscreen_context');
      if (storedContext) {
        try {
          const { hasEncounter } = JSON.parse(storedContext);
          if (hasEncounter) {
            setHasEncounter(true);
          }
        } catch (e) {
          console.warn('[care-insights] Failed to restore offscreen context:', e);
        }
      }
    } catch (err: any) {
      console.error('[care-insights] Init error:', err);
      setSdkError(err.message);
      setSdkStatus('error');
      initializedRef.current = false;
    } finally {
      initializingRef.current = false;
    }
  }

  // ── SDK Subscriptions ─────────────────────────────────────────────────────

  function setupSubscriptions(sdk: VimSDK) {
    const manifest = sdk.ehr.getManifest();
    const patientCtxKeys = findAllContextKeys(manifest, 'patient');
    const encounterCtxKeys = findAllContextKeys(manifest, 'encounter');

    console.log('[care-insights] Subscribing to contexts:', { patientCtxKeys, encounterCtxKeys });

    // ── Patient lifecycle ──
    // Track active patient context keys so we only call handlers on first open / last close.
    const activePatientKeys = new Set<string>();
    for (const key of patientCtxKeys) {
      try {
        sdk.ehr.context.onChange(key, async (prev, curr) => {
          if (!prev && curr) {
            const wasEmpty = activePatientKeys.size === 0;
            activePatientKeys.add(key);
            if (wasEmpty && !patientLoadingRef.current) await handlePatientOpened(sdk, curr);
          } else if (prev && !curr) {
            activePatientKeys.delete(key);
            if (activePatientKeys.size === 0) handlePatientClosed(sdk);
          }
        });
      } catch (err) {
        console.warn(`[care-insights] Could not subscribe to patient context ${key}:`, err);
      }
    }

    // ── Encounter lifecycle ──
    for (const key of encounterCtxKeys) {
      try {
        sdk.ehr.context.onChange(key, async (prev, curr) => {
          if (!prev && curr) {
            setHasEncounter(true);
            lastEncounterContextRef.current = curr;
            console.log('[care-insights] Encounter opened');
            // If no patient context yet, load patient from encounter's patient ID.
            // Guard against race with patient context arriving concurrently.
            if (!patientRef.current && !patientLoadingRef.current) {
              // Runtime encounter data may include identifiers.ehrPatientId — not in typed schema
              const patientId = (curr?.fields as any)?.identifiers?.ehrPatientId;
              if (patientId) {
                console.log('[care-insights] No patient context — loading patient from encounter:', patientId);
                try {
                  await handlePatientOpened(sdk, { id: patientId });
                } catch (err) {
                  console.error('[care-insights] Failed to load patient from encounter:', err);
                  setPatientLoading(false);
                }
              }
            } else if (patientRef.current) {
              autoResolveDiagnosisGaps(sdk, curr);
            }
          } else if (prev && curr) {
            // Encounter updated — re-check assessments for newly documented diagnoses
            lastEncounterContextRef.current = curr;
            autoResolveDiagnosisGaps(sdk, curr);
          } else if (prev && !curr) {
            lastEncounterContextRef.current = null;
            setHasEncounter(false);
            console.log('[care-insights] Encounter closed');
          }
        });
      } catch (err) {
        console.warn(`[care-insights] Could not subscribe to encounter context ${key}:`, err);
      }
    }
  }

  // ── Patient opened ────────────────────────────────────────────────────────

  async function handlePatientOpened(sdk: VimSDK, contextData: any) {
    patientLoadingRef.current = true;
    setPatientLoading(true);
    setActiveFilter('all');

    console.log('[care-insights] Patient context data:', JSON.stringify(contextData, null, 2));

    const patientId = contextData?.identifier?.id ?? contextData?.id;

    // Demographics live in contextData.fields — config uses "Demographics" (capital D)
    const fields = contextData?.fields ?? {};
    const demo = fields.Demographics?.value ?? fields.Demographics
              ?? fields.demographics?.value ?? fields.demographics
              ?? {};

    let patientInfo: PatientData = {
      ehrPatientId: patientId || 'unknown',
      firstName: demo?.firstName,
      lastName: demo?.lastName,
      dateOfBirth: demo?.dateOfBirth,
    };

    // If fields were empty, fall back to getPatient()
    if (!patientInfo.firstName && patientId && patientId !== 'NEW') {
      try {
        const response = await sdk.ehr.api.patient.getPatient({ patientId });
        console.log('[care-insights] getPatient response:', JSON.stringify(response, null, 2));
        if (response?.success && response.data) {
          const d = response.data?.demographics ?? (response.data as any)?.Demographics ?? {};
          patientInfo = {
            ehrPatientId: patientId,
            firstName: d?.firstName,
            lastName: d?.lastName,
            dateOfBirth: d?.dateOfBirth ?? d?.dob,
          };
        }
      } catch (err) {
        console.warn('[care-insights] getPatient failed:', err);
      }
    }

    // ── Insurance ────────────────────────────────────────────────────────────
    // Try context first; if not present, call the patient_insurance API.
    const ctxInsurance = fields?.insurance?.value ?? fields?.insurance
                      ?? fields?.Insurance?.value ?? fields?.Insurance;
    let insurance: Insurance[] | undefined;

    if (ctxInsurance) {
      insurance = Array.isArray(ctxInsurance) ? ctxInsurance : [ctxInsurance];
      console.log('[care-insights] Insurance from context:', insurance);
    } else if (patientId && patientId !== 'NEW') {
      try {
        console.log('[care-insights] Fetching insurance for patientId:', patientId);
        const insuranceResponse = await sdk.ehr.api.patient.getInsurances({ patientId });
        console.log('[care-insights] getInsurances response:', JSON.stringify(insuranceResponse, null, 2));
        if (insuranceResponse?.success && insuranceResponse.data) {
          insurance = insuranceResponse.data;
        }
      } catch (err) {
        console.warn('[care-insights] getPatient_insurance failed:', err);
      }
    }

    patientInfo.insurance = insurance;

    const initialGaps: GapWithStatus[] = MOCK_GAPS.map(gap => ({ gap, status: 'unresolved' }));
    const unresolvedCount = initialGaps.length;

    setPatient(patientInfo);
    patientRef.current = patientInfo;
    gapsRef.current = initialGaps;
    setGaps(initialGaps);
    setPatientLoading(false);
    patientLoadingRef.current = false;

    // Update hub
    sdk.hub.setActivationStatus('ENABLED');
    sdk.hub.setTooltipText('');
    sdk.hub.notificationBadge.set(unresolvedCount);

    console.log('[care-insights] Patient loaded:', patientInfo, `${unresolvedCount} gaps`);

    // Auto-resolve any gaps already documented in the current encounter
    if (lastEncounterContextRef.current) {
      autoResolveDiagnosisGaps(sdk, lastEncounterContextRef.current);
    }
  }

  // ── Patient closed ────────────────────────────────────────────────────────

  function handlePatientClosed(sdk: VimSDK) {
    setPatient(null);
    patientRef.current = null;
    gapsRef.current = [];
    setGaps([]);
    setHasEncounter(false);
    setPatientLoading(false);
    setActiveFilter('all');

    sdk.hub.setActivationStatus('DISABLED');
    sdk.hub.setTooltipText('Waiting for patient...');
    sdk.hub.notificationBadge.hide();

    console.log('[care-insights] Patient cleared');
  }

  // ── Auto-resolve ─────────────────────────────────────────────────────────

  function autoResolveDiagnosisGaps(sdk: VimSDK, encounterContext: any) {
    const fields = encounterContext?.fields ?? {};
    const assessmentDiagnoses: Array<{ code: string }> =
      fields?.soapAssessment?.diagnoses ??
      fields?.assessment?.diagnoses ??
      fields?.diagnoses ??
      [];

    console.log('[care-insights] Auto-resolve check, assessment diagnoses:', assessmentDiagnoses);

    if (!assessmentDiagnoses.length) return;

    // Log raw objects and gap codes to diagnose field-name mismatches
    console.log('[care-insights] Assessment diagnosis objects (raw):', JSON.stringify(assessmentDiagnoses));
    const diagnosisGaps = gapsRef.current.filter(g => g.gap.type === 'diagnosis');
    console.log('[care-insights] Gap ICD codes:', diagnosisGaps.map(g => (g.gap as DiagnosisGap).icdCode));

    // `code` is only present when the EHR renders a dual ICD-10/ICD-9 code (with a `/` separator).
    // For single ICD-10 codes the config regex doesn't match, so `code` is absent.
    // The `description` field's regex is currently broken and happens to contain the ICD code
    // for every item — so we match against both as a workaround.
    const assessedCodes = new Set(
      assessmentDiagnoses.flatMap((d: { code?: string; description?: string }) =>
        [d.code, d.description]
          .filter(Boolean)
          .map((c) => String(c).toUpperCase())
      )
    );
    const currentGaps = gapsRef.current;
    const toResolve = currentGaps.filter(
      g => g.gap.type === 'diagnosis' && g.status === 'unresolved' &&
           assessedCodes.has((g.gap as DiagnosisGap).icdCode?.toUpperCase())
    );

    if (!toResolve.length) return;

    const resolvedIds = new Set(toResolve.map(g => g.gap.id));
    const updated = currentGaps.map(g =>
      resolvedIds.has(g.gap.id) ? { ...g, status: 'added' as const, autoResolved: true } : g
    );
    gapsRef.current = updated;
    setGaps(updated);

    // Update badge
    const unresolvedCount = updated.filter(
      g => g.gap.type === 'diagnosis' && g.status === 'unresolved'
    ).length;
    if (unresolvedCount > 0) sdk.hub.notificationBadge.set(unresolvedCount);
    else sdk.hub.notificationBadge.hide();

    // Show a push notification for each auto-resolved gap
    const batchTs = Date.now();
    for (const [index, { gap }] of toResolve.entries()) {
      const diagGap = gap as DiagnosisGap;
      sdk.hub.pushNotification.show({
        notificationId: `ci-auto-resolved-${diagGap.icdCode}-${batchTs}-${index}`,
        text: `Gap "${diagGap.icdCode} ${diagGap.icdDescription}" resolved based on documented assessments`,
        timeoutInSec: 10,
        actionButtons: {
          rightButton: {
            text: 'View',
            buttonStyle: 'PRIMARY',
            openAppButton: true,
            callback: () => {},
          },
        },
      });
    }

    console.log('[care-insights] Auto-resolved gaps:', toResolve.map(g => (g.gap as DiagnosisGap).icdCode));
  }

  // ── Gap actions ───────────────────────────────────────────────────────────

  const handleDismiss = useCallback((id: string) => {
    setGaps(prev => {
      const updated = prev.map(g =>
        g.gap.id === id ? { ...g, status: 'dismissed' as const } : g
      );
      gapsRef.current = updated;
      // Update badge: count only unresolved diagnosis gaps (care gaps don't affect badge)
      const unresolvedDiagnosisCount = updated.filter(
        g => g.gap.type === 'diagnosis' && g.status === 'unresolved'
      ).length;
      sdkRef.current?.hub.notificationBadge.set(unresolvedDiagnosisCount);
      if (unresolvedDiagnosisCount === 0) sdkRef.current?.hub.notificationBadge.hide();
      return updated;
    });
  }, []);

  const handleAddToEncounter = useCallback(async (gap: DiagnosisGap) => {
    const sdk = sdkRef.current;
    if (!sdk) return;

    // Optimistically set to 'adding'
    setGaps(prev => {
      const updated = prev.map(g =>
        g.gap.id === gap.id ? { ...g, status: 'adding' as const } : g
      );
      gapsRef.current = updated;
      return updated;
    });

    try {
      /**
       * SDK Integration: Context Writeback
       *
       * Uses the per-entity writeback namespace (vimSDK.ehr.context.encounter).
       * getCapability() reflects all three availability layers (entity definition,
       * system config, active context). For disruptive automations, requestPermission()
       * shows a provider consent dialog before writing.
       *
       * Diagnosis object shape (from config typeDefinitions):
       *   { code: string, description: string }
       */
      const encounterNs = sdk.ehr.context.encounter;
      if (!encounterNs) throw new Error('Encounter writeback not configured');

      const cap = encounterNs.getCapability('update');
      if (!cap.available) {
        throw new Error(
          cap.reason === 'not_in_context' ? 'No active encounter' : 'Encounter update not supported'
        );
      }

      if (cap.disruptive && cap.permissionState !== 'granted') {
        const result = await encounterNs.requestPermission('update', { fields: ['diagnoses'] });
        if (result === 'denied') throw new Error('Permission denied by provider');
      }

      await encounterNs.update({
        diagnoses: [
          { code: gap.icdCode, description: gap.icdDescription },
        ],
      }, { mode: 'append' });

      setGaps(prev => {
        const updated = prev.map(g =>
          g.gap.id === gap.id ? { ...g, status: 'added' as const } : g
        );
        gapsRef.current = updated;
        // Update badge
        const unresolvedCount = updated.filter(
          g => g.gap.type === 'diagnosis' && g.status === 'unresolved'
        ).length;
        if (unresolvedCount > 0) sdk.hub.notificationBadge.set(unresolvedCount);
        else sdk.hub.notificationBadge.hide();
        return updated;
      });

    } catch (err: any) {
      console.error('[care-insights] Add to encounter failed:', err);
      setGaps(prev => {
        const updated = prev.map(g =>
          g.gap.id === gap.id
            ? { ...g, status: 'error' as const, errorMessage: err.message }
            : g
        );
        gapsRef.current = updated;
        return updated;
      });
    }
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const filteredGaps = gaps.filter(g => {
    if (activeFilter === 'diagnosis') return g.gap.type === 'diagnosis';
    if (activeFilter === 'care') return g.gap.type === 'care';
    return true;
  });

  const unresolvedCount = gaps.filter(g => g.status === 'unresolved').length;

  // ── Render ────────────────────────────────────────────────────────────────

  if (sdkStatus === 'loading' || patientLoading) {
    return <SkeletonView />;
  }

  if (sdkStatus === 'error') {
    return (
      <div style={{ background: '#f5f6f8', minHeight: '100vh' }}>
        <div className={styles.errorWrap}>
          <h3>Connection Error</h3>
          <p>{sdkError}</p>
          <button className={styles.retryBtn} onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      {/* Patient header — sticky */}
      {patient && (
        <PatientHeader patient={patient} hasEncounter={hasEncounter} />
      )}

      {/* Body */}
      {!patient ? (
        <EmptyState reason="no-patient" />
      ) : gaps.length === 0 ? (
        <EmptyState reason="no-gaps" />
      ) : (
        <>
          {/* Summary + filter */}
          <div className={styles.summaryBanner}>
            <span>
              <span className={styles.summaryCount}>{unresolvedCount}</span> open gap{unresolvedCount !== 1 ? 's' : ''}
            </span>
            {!hasEncounter && (
              <span style={{ fontSize: 10.5, color: '#f59e0b', fontWeight: 500 }}>
                ⚠ No active encounter
              </span>
            )}
          </div>

          <FilterBar
            gaps={gaps}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />

          {/* Gap cards */}
          <div className={styles.gapsList}>
            {filteredGaps.length === 0 ? (
              <EmptyState reason="all-dismissed" />
            ) : (
              filteredGaps.map(gapWithStatus => (
                <GapCard
                  key={gapWithStatus.gap.id}
                  gapWithStatus={gapWithStatus}
                  hasEncounter={hasEncounter}
                  onDismiss={handleDismiss}
                  onAddToEncounter={handleAddToEncounter}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function CareInsightsAppPage() {
  return (
    <Suspense fallback={<SkeletonView />}>
      <CareInsightsContent />
    </Suspense>
  );
}
