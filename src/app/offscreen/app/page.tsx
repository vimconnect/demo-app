'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { initWorkerVimSDK } from '@vimconnect/app-sdk';
import type { WorkerSDK, ContextData } from '@vimconnect/app-sdk';
import { getEnvironment } from '@/lib/sdk-config';
import {
  DEMO_WORKER_STATE_KEY,
  REFRESH_DEMO_EVENT,
  buildDemoWorkerData,
} from '@/lib/worker-demo';

/**
 * Offscreen Worker App Page — headless background SDK worker (Phase 1)
 *
 * Loaded inside a hidden iframe managed by OffscreenAppManager.
 * Uses VimSDK.initWorker() (WorkerSDK) to:
 *   - Register for context events (patient, encounter) and write to workerState
 *   - Register for workflow events and send push notifications
 *   - Monitor hub.appState (whether the UI App is visible)
 *
 * Auth flow (mirrors the old offscreen/app pattern):
 *   1. OAuth code + state arrive via query params
 *   2. CSRF state validated from sessionStorage
 *   3. Code exchanged for access token via /token
 *   4. VimSDK.initWorker({ accessToken }) called
 *
 * This page renders no visible UI.
 * Look for '[offscreen/worker]' console messages for E2E test verification.
 */
function OffscreenWorkerContent() {
  const searchParams = useSearchParams();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWorker();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function initWorker() {
    try {
      const code = searchParams.get('code');
      const stateParam = searchParams.get('state');

      if (!code || !stateParam) {
        console.error('[offscreen/worker] Missing OAuth parameters');
        return;
      }

      // CSRF validation
      const stateParts = stateParam.split(':');
      if (stateParts.length !== 2) {
        console.error('[offscreen/worker] Malformed state parameter');
        return;
      }
      const [launchId, csrfToken] = stateParts;
      const flowKey = `oauth_state_${launchId}`;
      const storedCsrf = sessionStorage.getItem(flowKey);
      if (storedCsrf !== csrfToken) {
        console.error('[offscreen/worker] CSRF state mismatch');
        return;
      }
      sessionStorage.removeItem(flowKey);

      // Exchange code for access token
      const tokenRes = await fetch('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!tokenRes.ok) {
        console.error('[offscreen/worker] Token exchange failed');
        return;
      }

      const { access_token: accessToken } = await tokenRes.json().catch(() => ({}));
      if (!accessToken) {
        console.error('[offscreen/worker] No access_token in response');
        return;
      }

      // Initialise Worker SDK (uses VIM_SDK_READY + contextType='worker' handshake).
      // Same runtime override as the UI page: only when THIS app is running in
      // staging do we point the SDK at the staging core-sdk, so the staging worker
      // surface exercises the workspace SDK too. `__overrideEnv` is runtime-only
      // (not in the public type) → cast. Origin gate still applies (this page is
      // served from the demo-app origin, which is whitelisted on staging).
      const sdk: WorkerSDK = await initWorkerVimSDK({
        accessToken,
        ...(getEnvironment() === 'staging' ? { __overrideEnv: 'staging' } : {}),
      } as Parameters<typeof initWorkerVimSDK>[0] & { __overrideEnv?: 'staging' });
      console.log('[offscreen/worker] Worker SDK ready');

      // ── Worker App → UI App round-trip demo (workerState + appEvents) ────────
      // Seed mock state immediately so the UI App has something to render on
      // open (workerState is subscribe-and-sync). A refreshCount closure lets
      // each regeneration produce visibly-new data.
      let demoRefreshCount = 0;
      const writeDemoData = () => {
        demoRefreshCount += 1;
        const data = buildDemoWorkerData(demoRefreshCount);
        sdk.workerState.write(DEMO_WORKER_STATE_KEY, data);
        console.log('[offscreen/worker] workerState.write demoWorkerData', data);
      };
      writeDemoData();

      // appEvents is capability-gated: present only when the host extension
      // advertises it. Older extensions leave it undefined — degrade gracefully
      // (initial state still syncs; the UI App's Refresh button becomes a no-op).
      if (sdk.appEvents) {
        sdk.appEvents.on(REFRESH_DEMO_EVENT, () => {
          console.log('[offscreen/worker] appEvents received:', REFRESH_DEMO_EVENT, '→ regenerating');
          writeDemoData();
        });
        console.log('[offscreen/worker] appEvents listener registered for', REFRESH_DEMO_EVENT);
      } else {
        console.warn(
          '[offscreen/worker] appEvents NOT supported by this extension — Refresh button will be a no-op',
        );
      }

      // ── Monitor UI App open/close state ──────────────────────────────────────
      sdk.hub.appState.subscribe('appOpenStatus', (status: { isAppOpen: boolean }) => {
        console.log('[offscreen/worker] App open status changed:', status.isAppOpen);
        sdk.workerState.write('appIsOpen', status.isAppOpen);
      });

      // ── Register for context changes ──────────────────────────────────────────
      // Hardcode context keys — WorkerSDK does not expose getManifest().
      const supportedContexts = [
        { contextKey: 'chart_open:patient' },
      ];

      for (const ctx of supportedContexts) {
        const { contextKey } = ctx;

        sdk.ehr.context.register<ContextData>(
          contextKey,
          {
            // Declare that we only need firstName and lastName fields
            // Callback only fires when these fields change or are first available
            fields: ['firstName', 'lastName', 'dateOfBirth'],
            debounceMs: 200,
          },
          (prev, curr, handle) => {
            if (curr == null) {
              console.log(`[offscreen/worker] Context cleared: ${contextKey}`);
              return;
            }

            console.log(`[offscreen/worker] Context changed: ${contextKey}`, curr?.fields);

            // Send a push notification if notify operation is available
            if (handle.hub != null) {
              handle.hub.pushNotification.show({
                text: `Patient context updated: ${curr?.fields?.firstName ?? 'Unknown'}`,
                notificationId: `patient-update-${contextKey}`,
                timeoutInSec: 8,
                launchPayload: { contextKey, patientId: curr?.id },
              }).catch((err) => console.error('[offscreen/worker] Notification failed:', err));
            }
          }
        );

        console.log(`[offscreen/worker] Registered context: ${contextKey}`);
      }

      console.log('[offscreen/worker] Worker SDK fully initialized');
    } catch (err) {
      console.error('[offscreen/worker] Init error:', err);
    }
  }

  // No visible UI — runs silently in a hidden background iframe
  return null;
}

export default function OffscreenWorkerPage() {
  return (
    <Suspense fallback={null}>
      <OffscreenWorkerContent />
    </Suspense>
  );
}
