'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root page - redirects to /launch
 * Extension should embed iframe at /launch?launch_id=xxx
 */
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    // Preserve query params when redirecting
    const params = new URLSearchParams(window.location.search);
    router.push(`/launch?${params.toString()}`);
  }, [router]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <p style={{ color: '#6b7280' }}>Redirecting...</p>
    </div>
  );
}
