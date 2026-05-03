'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVimBackendUrl, getAppUrl } from '@/lib/sdk-config';

/**
 * Landing Page - OAuth Flow Launcher
 *
 * This page receives the launch_id from the extension iframe URL
 * and immediately redirects to Vim's OAuth authorization endpoint
 */
function LaunchPageContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate redirects (React StrictMode runs effects twice)
  const redirectingRef = useRef(false);

  useEffect(() => {
    // Only redirect once
    if (redirectingRef.current) {
      console.log('LandingPage: Skipping duplicate redirect');
      return;
    }

    const launchId = searchParams.get('launch_id');

    console.log('LandingPage: Starting OAuth flow', { launchId });

    if (!launchId) {
      setError('Missing launch_id parameter. This app must be launched from Vim Connect extension.');
      return;
    }

    // Mark as redirecting before any async operations
    redirectingRef.current = true;

    // Generate CSRF state token (only once!)
    // Use launch_id as the flow identifier to avoid conflicts between tabs
    const csrfToken = crypto.randomUUID();
    const flowKey = `oauth_state_${launchId}`;
    sessionStorage.setItem(flowKey, csrfToken);
    console.log('LandingPage: Generated state token for flow:', {
      launchId: launchId.substring(0, 12) + '...',
      csrfToken: csrfToken.substring(0, 8) + '...',
    });

    // Encode launch_id in state parameter so we can look it up on callback
    // Format: "launchId:csrfToken"
    const stateParam = `${launchId}:${csrfToken}`;

    // Build OAuth authorization URL
    const vimBackendUrl = getVimBackendUrl();
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
    const appUrl = getAppUrl();

    const authorizeUrl = new URL('/app-auth/authorize', vimBackendUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId!);
    authorizeUrl.searchParams.set('launch', launchId);
    authorizeUrl.searchParams.set('scope', 'launch openid');
    authorizeUrl.searchParams.set('redirect_uri', `${appUrl}/app`);
    authorizeUrl.searchParams.set('state', stateParam);

    console.log('LandingPage: Redirecting to OAuth authorization:', authorizeUrl.toString());

    // Redirect to Vim OAuth
    window.location.href = authorizeUrl.toString();
  }, []); // Empty dependency array - only run once on mount

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          maxWidth: '500px',
          padding: '24px',
          border: '1px solid #fee',
          borderRadius: '8px',
          backgroundColor: '#fef2f2',
          color: '#991b1b',
        }}>
          <h2 style={{ marginTop: 0 }}>Launch Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid #f3f4f6',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 16px',
        }} />
        <p style={{ color: '#6b7280' }}>Redirecting to Vim Connect...</p>
        <style jsx>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #f3f4f6',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{ color: '#6b7280' }}>Loading...</p>
        </div>
      </div>
    }>
      <LaunchPageContent />
    </Suspense>
  );
}
