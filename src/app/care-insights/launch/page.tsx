'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVimBackendUrl, getAppUrl } from '@/lib/sdk-config';

function CareInsightsLaunchContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  useEffect(() => {
    if (redirectingRef.current) return;

    const launchId = searchParams.get('launch_id');
    if (!launchId) {
      setError('Missing launch_id parameter. This app must be launched from the Vim Connect extension.');
      return;
    }

    redirectingRef.current = true;

    const csrfToken = crypto.randomUUID();
    sessionStorage.setItem(`oauth_state_${launchId}`, csrfToken);

    const stateParam = `${launchId}:${csrfToken}`;
    const vimBackendUrl = getVimBackendUrl();
    const clientId = process.env.NEXT_PUBLIC_CARE_INSIGHTS_CLIENT_ID;
    const appUrl = getAppUrl();

    const authorizeUrl = new URL('/app-auth/authorize', vimBackendUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId!);
    authorizeUrl.searchParams.set('launch', launchId);
    authorizeUrl.searchParams.set('scope', 'launch openid');
    authorizeUrl.searchParams.set('redirect_uri', `${appUrl}/care-insights/app`);
    authorizeUrl.searchParams.set('state', stateParam);

    window.location.href = authorizeUrl.toString();
  }, []);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f6f8' }}>
        <div style={{ maxWidth: 400, padding: 24, background: '#fff', borderRadius: 8, border: '1px solid #fee', color: '#991b1b', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Launch Error</h3>
          <p style={{ margin: 0, fontSize: 13 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f6f8' }}>
      <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#001c36', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p>Launching Care Insights...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function CareInsightsLaunchPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f5f6f8' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#001c36', borderRadius: '50%' }} />
      </div>
    }>
      <CareInsightsLaunchContent />
    </Suspense>
  );
}
