/**
 * Care Insights Mock App — Server Configuration
 *
 * Lazily loads credentials on first token-exchange request.
 * Local dev: reads from CARE_INSIGHTS_CLIENT_ID / CARE_INSIGHTS_CLIENT_SECRET env vars.
 * Staging/prod: fetches from AWS Secrets Manager (vim-connect/{env}/care-insights-mock).
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getVimBackendUrl } from './sdk-config';

interface CareInsightsConfig {
  clientId: string;
  clientSecret: string;
  vimBackendUrl: string;
}

let cachedConfig: CareInsightsConfig | null = null;
let initPromise: Promise<CareInsightsConfig> | null = null;

export async function getCareInsightsServerConfig(): Promise<CareInsightsConfig> {
  if (cachedConfig) return cachedConfig;
  if (initPromise) return initPromise;

  initPromise = _load();
  cachedConfig = await initPromise;
  initPromise = null;
  return cachedConfig;
}

async function _load(): Promise<CareInsightsConfig> {
  const env = process.env.NEXT_PUBLIC_ENV as 'local' | 'staging' | 'production';

  const clientId = process.env.NEXT_PUBLIC_CARE_INSIGHTS_CLIENT_ID;
  if (!clientId) {
    throw new Error('NEXT_PUBLIC_CARE_INSIGHTS_CLIENT_ID is required');
  }

  const clientSecret = await _fetchSecret(env);
  const vimBackendUrl = getVimBackendUrl();

  console.log('[care-insights-config] ✅ Loaded', { env, clientId, vimBackendUrl });

  return { clientId, clientSecret, vimBackendUrl };
}

async function _fetchSecret(env: 'local' | 'staging' | 'production'): Promise<string> {
  if (env === 'local') {
    const secret = process.env.CARE_INSIGHTS_CLIENT_SECRET;
    if (!secret) throw new Error('CARE_INSIGHTS_CLIENT_SECRET is required for local development');
    return secret;
  }

  const secretName = `vim-connect/${env}/care-insights-mock`;
  console.log(`[care-insights-config] Fetching secret: ${secretName}`);

  const client = new SecretsManagerClient();
  const maxRetries = 5;
  const baseDelayMs = 100;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await client.send(command);

      if (!response.SecretString) throw new Error('Secret value is empty');

      const parsed = JSON.parse(response.SecretString) as Record<string, unknown>;
      const secret = parsed.CLIENT_SECRET;

      if (typeof secret !== 'string' || !secret) {
        throw new Error('Secret is missing CLIENT_SECRET field');
      }

      return secret;
    } catch (error) {
      lastError = error as Error;
      const isCredentialsError =
        lastError.name === 'CredentialsProviderError' ||
        lastError.message.includes('Could not load credentials');

      if (!isCredentialsError || attempt === maxRetries) break;

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Failed to fetch care-insights secret from AWS: ${lastError?.message || 'Unknown error'}`
  );
}
