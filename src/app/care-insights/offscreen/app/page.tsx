'use client';

import { initVimSDK, type ContextKey, type EntityTypeMap, type EventType, type Patient } from '@vimconnect/app-sdk';

/**
 * Care Insights — Offscreen Worker App
 *
 * Loaded by the extension in a hidden iframe (OffscreenAppManager).
 * Completes its own OAuth flow (launch → this page) independently from
 * the sidepanel app, so it works even when the provider has never opened
 * the sidepanel.
 *
 * After exchanging the authorization code for an access token, it runs
 * silently as a background SDK client: tracking patient/encounter context,
 * updating the hub badge, and firing push notifications for unresolved gaps.
 */

import { Suspense, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { MOCK_GAPS } from '../../app/data/mockGaps';
import type { VimSDK, AppManifest } from '@vimconnect/app-sdk';

const EVENT_PATIENT = 'chart_open';
const EVENT_ENCOUNTER = 'encounter_open';
const OFFSCREEN_CONTEXT_KEY = 'care_insights_offscreen_context';

interface ManifestContext {
  entityType?: string;
  type?: string;
  contextKey?: string;
  key?: string;
  workflowEventId?: string;
  eventType?: string;
}

function findContextKey(manifest: AppManifest, entityType: keyof EntityTypeMap, eventId: EventType): ContextKey {
  const contexts: ManifestContext[] = manifest?.supportedContexts || [];
  const ctx = contexts.find(
    (c) =>
      (c.entityType === entityType || c.type === entityType) &&
      (!eventId || c.workflowEventId === eventId || c.eventType?.includes(eventId))
  );
  return (ctx?.contextKey ?? ctx?.key ?? `${eventId}:${entityType}`) as ContextKey;
}

function showGapNotification(sdk: VimSDK, gapCount: number, patientFirstName?: string) {
  const diagnosisCount = MOCK_GAPS.filter(g => g.type === 'diagnosis').length;
  const careCount = MOCK_GAPS.filter(g => g.type === 'care').length;

  const parts: string[] = [];
  if (careCount > 0) parts.push(`${careCount} Care gap${careCount !== 1 ? 's' : ''}`);
  if (diagnosisCount > 0) parts.push(`${diagnosisCount} Diagnosis gap${diagnosisCount !== 1 ? 's' : ''}`);

  const forPatient = patientFirstName ? ` for ${patientFirstName}` : '';
  const text = `${gapCount} Care Insights available${forPatient} - ${parts.join(', ')}`;

  sdk.hub.pushNotification.show({
    notificationId: `care-insights-encounter-${Date.now()}`,
    text,
    timeoutInSec: 12,
    actionButtons: {
      rightButton: {
        text: 'Review',
        buttonStyle: 'PRIMARY',
        openAppButton: true,
        callback: () => {},
      },
    },
  });
}

function CareInsightsOffscreenAppContent() {
  const searchParams = useSearchParams();
  const initializedRef = useRef(false);

  const initWorker = useCallback(async (accessToken: string) => {
    try {
      const sdk = await initVimSDK({ accessToken, debug: false });
      console.log('[care-insights/offscreen/app] SDK ready');

      const manifest = sdk.ehr.getManifest();
      const patientCtxKey = findContextKey(manifest, 'patient', EVENT_PATIENT);
      const encounterCtxKey = findContextKey(manifest, 'encounter', EVENT_ENCOUNTER);

      let currentPatientFirstName: string | undefined;

      sdk.ehr.context.onChange(patientCtxKey, (prev, curr) => {
        if (!prev && curr) {
          console.log('[care-insights/offscreen/app] Patient opened');
          const fields = curr.fields as any;
          const demo = fields.demographics?.value ?? fields.demographics
                    ?? fields.Demographics?.value ?? fields.Demographics ?? {};
          currentPatientFirstName = demo?.firstName;
          localStorage.setItem(OFFSCREEN_CONTEXT_KEY, JSON.stringify({ hasEncounter: false }));
          sdk.hub.setActivationStatus('ENABLED');
          sdk.hub.setTooltipText('');
        } else if (prev && !curr) {
          console.log('[care-insights/offscreen/app] Patient closed');
          currentPatientFirstName = undefined;
          localStorage.removeItem(OFFSCREEN_CONTEXT_KEY);
          sdk.hub.setActivationStatus('DISABLED');
          sdk.hub.setTooltipText('Waiting for patient...');
          sdk.hub.notificationBadge.hide();
        }
      });

      sdk.ehr.context.onChange(encounterCtxKey, (prev, curr) => {
        if (!prev && curr) {
          console.log('[care-insights/offscreen/app] Encounter opened');
          localStorage.setItem(OFFSCREEN_CONTEXT_KEY, JSON.stringify({ hasEncounter: true }));
          showGapNotification(sdk, MOCK_GAPS.length, currentPatientFirstName);
        } else if (prev && !curr) {
          console.log('[care-insights/offscreen/app] Encounter closed');
          localStorage.setItem(OFFSCREEN_CONTEXT_KEY, JSON.stringify({ hasEncounter: false }));
        }
      });
    } catch (err: any) {
      console.error('[care-insights/offscreen/app] Init error:', err);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      try {
        const code = searchParams.get('code');
        const stateParam = searchParams.get('state');

        if (!code || !stateParam) {
          console.error('[care-insights/offscreen/app] Missing OAuth parameters');
          return;
        }

        const [launchId, csrfToken] = stateParam.split(':');
        if (!launchId || !csrfToken) {
          console.error('[care-insights/offscreen/app] Malformed state parameter');
          return;
        }

        const flowKey = `oauth_state_${launchId}`;
        const storedToken = sessionStorage.getItem(flowKey);
        if (csrfToken !== storedToken) {
          console.error('[care-insights/offscreen/app] CSRF state mismatch');
          return;
        }
        sessionStorage.removeItem(flowKey);

        const tokenRes = await fetch('/care-insights/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!tokenRes.ok) {
          const err = await tokenRes.json().catch(() => ({}));
          console.error('[care-insights/offscreen/app] Token exchange failed:', err);
          return;
        }

        const { access_token } = await tokenRes.json();
        await initWorker(access_token);
      } catch (err) {
        console.error('[care-insights/offscreen/app] Unexpected error:', err);
      }
    }

    init();
  }, [searchParams, initWorker]);

  return null;
}

export default function CareInsightsOffscreenAppPage() {
  return (
    <Suspense fallback={null}>
      <CareInsightsOffscreenAppContent />
    </Suspense>
  );
}
