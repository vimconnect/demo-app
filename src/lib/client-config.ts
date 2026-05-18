// Explicit allowlist — only values that need to reach the client bundle.
// buildClientConfig() is called server-side (layout.tsx), so process.env
// is read at request time, not at build time.

export interface ClientConfig {
  clientId: string;
  env: 'local' | 'staging' | 'production';
}

const VALID_ENVS = ['local', 'staging', 'production'] as const;

export function buildClientConfig(): ClientConfig {
  if (!process.env.CLIENT_ID) throw new Error('CLIENT_ID is required');
  const env = process.env.APP_ENV ?? 'staging';
  if (!(VALID_ENVS as readonly string[]).includes(env)) {
    throw new Error(`Invalid APP_ENV: ${env}. Must be one of: local, staging, production`);
  }
  return {
    clientId: process.env.CLIENT_ID,
    env: env as ClientConfig['env'],
  };
}

// SSR-safe accessor. Same call site works in both server and client components.
// Server: reads process.env via buildClientConfig() (called at request time).
// Client: reads window.__CONFIG__ injected by layout.tsx SSR.
export function getConfig(): ClientConfig {
  if (typeof window === 'undefined') return buildClientConfig();
  const config = window.__CONFIG__;
  if (!config) throw new Error('window.__CONFIG__ is not injected — ensure layout.tsx uses force-dynamic');
  return config;
}
