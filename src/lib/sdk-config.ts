/**
 * SDK Configuration
 *
 * Calculates SDK URL, backend URL, and app URL based on environment
 * All functions require NEXT_PUBLIC_ENV to be set - no fallbacks!
 *
 * Note: Server-side validation happens in config.ts at startup.
 * If NEXT_PUBLIC_ENV is invalid, the server won't start and this code never runs.
 * This validation is for client-side safety (build-time env vars).
 */

export function getEnvironment(): 'local' | 'staging' | 'production' {
  const env = process.env.NEXT_PUBLIC_ENV;

  if (!env) {
    throw new Error(
      'NEXT_PUBLIC_ENV is not set. Set to: local, staging, or production'
    );
  }

  if (!['local', 'staging', 'production'].includes(env)) {
    throw new Error(
      `NEXT_PUBLIC_ENV must be one of: local, staging, production. Got: ${env}`
    );
  }

  return env as 'local' | 'staging' | 'production';
}

export function getVimBackendUrl(): string {
  // Allow override via environment variable
  if (process.env.NEXT_PUBLIC_VIM_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_VIM_BACKEND_URL;
  }

  // Calculate based on validated environment
  const env = getEnvironment();

  switch (env) {
    case 'local':
      return 'http://localhost:3000';

    case 'staging':
      return 'https://api.stage.getvim.ai';

    case 'production':
      return 'https://api.getvim.ai';
  }
}

export function getAppUrl(): string {
  // Allow override via environment variable
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  // Client-side: use current origin (always correct!)
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // Server-side: calculate based on validated environment
  const env = getEnvironment();

  switch (env) {
    case 'local':
      return 'http://localhost:8080';

    case 'staging':
      // In staging, you'd typically deploy to a specific URL
      // This is a reasonable default, but should be overridden
      return 'http://localhost:8080';

    case 'production':
      // In production, this should definitely be overridden
      return 'https://demo.getvim.ai';
  }
}
