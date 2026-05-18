'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVimBackendUrl, getAppUrl } from '@/lib/sdk-config';
import { getConfig } from '@/lib/client-config';

/**
 * Offscreen Launch Page - OAuth Flow Initiator
 *
 * Loaded by the extension in a hidden offscreen iframe as `workerLaunchEndpoint`.
 * Receives the launch_id from the URL, then redirects to Vim's OAuth endpoint.
 * After OAuth completes, the authorization server redirects to /offscreen/app.
 *
 * This page is identical in purpose to /launch, but:
 * - Uses redirect_uri pointing to /offscreen/app (the headless background worker)
 * - Has no visible UI (runs silently inside a hidden iframe)
 */
function OffscreenLaunchContent() {
  const searchParams = useSearchParams();
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (redirectingRef.current) return;

    const launchId = searchParams.get('launch_id');
    if (!launchId) {
      console.error('[offscreen/launch] Missing launch_id');
      return;
    }

    redirectingRef.current = true;

    // Store CSRF state token in sessionStorage (same-origin iframe shares it with /offscreen/app)
    const csrfToken = crypto.randomUUID();
    const flowKey = `oauth_state_${launchId}`;
    sessionStorage.setItem(flowKey, csrfToken);

    const stateParam = `${launchId}:${csrfToken}`;

    const vimBackendUrl = getVimBackendUrl();
    const clientId = getConfig().clientId;
    const appUrl = getAppUrl();

    const authorizeUrl = new URL('/app-auth/authorize', vimBackendUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId!);
    authorizeUrl.searchParams.set('launch', launchId);
    authorizeUrl.searchParams.set('scope', 'launch openid');
    authorizeUrl.searchParams.set('redirect_uri', `${appUrl}/offscreen/app`);
    authorizeUrl.searchParams.set('state', stateParam);

    console.log('[offscreen/launch] Redirecting to OAuth authorization');
    window.location.href = authorizeUrl.toString();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: runs once on mount; redirectingRef guards against double-invocation

  // No UI — this page redirects immediately
  return null;
}

export default function OffscreenLaunchPage() {
  return (
    <Suspense fallback={null}>
      <OffscreenLaunchContent />
    </Suspense>
  );
}
