import { NextRequest, NextResponse } from 'next/server';
import { getServerConfig } from '@/lib/config';

/**
 * POST /api/auth/token
 *
 * Exchanges OAuth authorization code for access token
 * This endpoint acts as a secure proxy to keep CLIENT_SECRET server-side
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json(
        { error: 'Missing authorization code' },
        { status: 400 }
      );
    }

    // Get config from memory (already validated and fetched at server startup)
    const config = getServerConfig();
    const { clientId, clientSecret, vimBackendUrl } = config;

    // Exchange code for token with Vim backend
    console.log('Exchanging code for token with Vim backend...', {
      vimBackendUrl,
    });
    const tokenResponse = await fetch(`${vimBackendUrl}/app-auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      console.error('Token exchange failed:', tokenResponse.status, tokenResponse.statusText, errorData);
      return NextResponse.json(
        {
          error: errorData.error || 'token_exchange_failed',
          error_description: errorData.error_description || 'Failed to exchange code for token',
        },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');

    return NextResponse.json({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'Bearer',
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });

  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json(
      { error: 'internal_server_error', error_description: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
