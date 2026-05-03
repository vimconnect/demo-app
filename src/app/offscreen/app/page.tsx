'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { initVimSDK, type EventType } from '@vimconnect/app-sdk';

/**
 * Offscreen App Page - Headless Background SDK Worker
 *
 * This page is the OAuth callback target for the offscreen launch flow.
 * It runs silently in a hidden iframe managed by OffscreenAppManager.
 *
 * Flow:
 * 1. Receives OAuth code + state from /offscreen/launch redirect
 * 2. Validates CSRF state from sessionStorage
 * 3. Exchanges code for access token via POST /api/auth/token
 * 4. Initialises VimSDK with the access token
 * 5. Subscribes to workflow events and logs them (no UI)
 *
 * This page has no rendered UI — it returns null.
 * Useful for E2E testing: look for '[offscreen/app] SDK ready' in the console.
 */
function OffscreenAppContent() {
  const searchParams = useSearchParams();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function initOffscreen() {
      try {
        const code = searchParams.get('code');
        const stateParam = searchParams.get('state');

        if (!code || !stateParam) {
          console.error('[offscreen/app] Missing OAuth parameters — was this page loaded directly?');
          return;
        }

        // Validate CSRF state (stored by /offscreen/launch before redirect)
        const stateParts = stateParam.split(':');
        if (stateParts.length !== 2) {
          console.error('[offscreen/app] Malformed state parameter');
          return;
        }
        const [launchId, csrfToken] = stateParts;

        // Note: sessionStorage is the standard browser-side CSRF pattern for OAuth flows.
        // For production apps a BFF with httpOnly cookies should be used instead.
        const flowKey = `oauth_state_${launchId}`;
        const storedCsrf = sessionStorage.getItem(flowKey);
        if (storedCsrf !== csrfToken) {
          console.error('[offscreen/app] CSRF state mismatch — possible replay attack');
          return;
        }
        sessionStorage.removeItem(flowKey);

        // Exchange authorization code for access token
        const tokenRes = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!tokenRes.ok) {
          console.error('[offscreen/app] Token exchange failed');
          return;
        }

        const { access_token: accessToken } = await tokenRes.json().catch(() => ({}));

        if (!accessToken) {
          console.error('[offscreen/app] No access_token in response');
          return;
        }

        // Initialise SDK — sends VIM_SDK_READY with the access token to the extension bridge
        const sdk = await initVimSDK({ accessToken });
        console.log('[offscreen/app] SDK ready');

        // Subscribe to workflow events — log them for E2E test verification
        const manifest = sdk.ehr.getManifest();
        const supportedEvents = manifest?.supportedEvents ?? [];

        for (const eventType of supportedEvents) {
          sdk.ehr.workflow.on(eventType.id as EventType, (event) => {
            console.log(`[offscreen/app] workflow event: ${eventType.id}`, event);
          });
        }
      } catch (err) {
        console.error('[offscreen/app] Init error:', err);
      }
    }
    initOffscreen();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: runs once on mount; initializedRef guards against double-invocation

  // No visible UI — runs silently in the background iframe
  return null;
}

export default function OffscreenAppPage() {
  return (
    <Suspense fallback={null}>
      <OffscreenAppContent />
    </Suspense>
  );
}
