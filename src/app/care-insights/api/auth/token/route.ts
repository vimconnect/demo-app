import { NextRequest, NextResponse } from 'next/server';
import { getCareInsightsServerConfig } from '@/lib/care-insights-config';

/**
 * POST /care-insights/api/auth/token
 *
 * Exchanges OAuth authorization code for access token using the
 * Care Insights app's own client credentials.
 */

// OAuth authorization codes are alphanumeric strings (plus safe URL chars).
// Reject anything that doesn't match to prevent injection attacks.
const AUTHORIZATION_CODE_RE = /^[A-Za-z0-9\-_.~]+$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
    }

    // Validate code format — reject malformed values before forwarding upstream
    if (!AUTHORIZATION_CODE_RE.test(code) || code.length > 512) {
      return NextResponse.json({ error: 'Invalid authorization code format' }, { status: 400 });
    }

    const { clientId, clientSecret, vimBackendUrl } = await getCareInsightsServerConfig();

    const tokenResponse = await fetch(`${vimBackendUrl}/app-auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: errorData.error || 'token_exchange_failed',
          error_description: errorData.error_description || 'Failed to exchange code for token',
        },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();

    return NextResponse.json({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'Bearer',
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (error) {
    // Log only the message — never the full error object which may contain secrets
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[care-insights/token] Error:', message);
    return NextResponse.json(
      { error: 'internal_server_error', error_description: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
