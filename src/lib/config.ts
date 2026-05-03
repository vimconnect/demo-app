/**
 * Server Configuration Service
 *
 * Reads secrets from environment variables (injected by App Runner from Secrets Manager)
 * and validates all config once at server startup.
 * All config is loaded into memory and validated before the server accepts requests.
 */

// ============================================================================
// Types
// ============================================================================

export interface ServerConfig {
  env: 'local' | 'staging' | 'production';
  clientId: string;
  clientSecret: string;
  vimBackendUrl: string;
  appUrl: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// ============================================================================
// Config Service (Singleton)
// ============================================================================

class ConfigService {
  private config: ServerConfig | null = null;
  
  /**
   * Initialize configuration
   * - Reads secrets from env vars (App Runner injects them from Secrets Manager)
   * - Validates all required environment variables
   * - Stores config in memory
   *
   * Called automatically on module import. Safe to call multiple times.
   */
  initialize(): void {
    // Skip during next build — secrets aren't available at build time
    if (process.env.NEXT_PHASE === 'phase-production-build') return;

    // If already initialized, return immediately
    if (this.config) {
      console.log('[config] Already initialized, skipping');
      return;
    }

    this._doInitialize();
  }

  private _doInitialize(): void {
    console.log('[config] Starting configuration initialization...');

    // Auth bypass mode: PR preview environments run without real OAuth credentials.
    // The app starts healthy so health checks pass; the OAuth flow is non-functional.
    if (process.env.NEXT_PUBLIC_AUTH_BYPASS === 'true') {
      this.config = {
        env: 'staging',
        clientId: process.env.NEXT_PUBLIC_CLIENT_ID || 'bypass-mode',
        clientSecret: 'bypass-mode',
        vimBackendUrl: 'https://api.stage.getvim.ai',
        appUrl: '',
      };
      console.log('[config] Auth bypass mode — stub config initialised (no real credentials)');
      return;
    }

    try {
      // 1. Validate and get environment
      const env = this._validateEnvironment();
      console.log(`[config] Environment: ${env}`);

      // 2. Validate required env vars
      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      if (!clientId) {
        throw new ConfigError('NEXT_PUBLIC_CLIENT_ID is required');
      }

      // 3. Read CLIENT_SECRET (injected by App Runner from Secrets Manager)
      const clientSecret = this._fetchClientSecret();
      console.log('[config] CLIENT_SECRET read successfully');

      // 4. Get other config values
      const vimBackendUrl = this._getVimBackendUrl(env);
      const appUrl = this._getAppUrl(env);

      // 5. Store validated config
      this.config = {
        env,
        clientId,
        clientSecret,
        vimBackendUrl,
        appUrl,
      };

      console.log('[config] ✅ Configuration initialized successfully', {
        env: this.config.env,
        clientId: this.config.clientId,
        vimBackendUrl: this.config.vimBackendUrl,
        appUrl: this.config.appUrl,
      });
    } catch (error) {
      console.error('[config] ❌ Configuration initialization failed:', error);
      process.exit(1);
    }
  }

  /**
   * Get the validated server configuration
   */
  getConfig(): ServerConfig {
    if (!this.config) {
      throw new ConfigError('Configuration not initialized.');
    }
    return this.config;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private _validateEnvironment(): 'local' | 'staging' | 'production' {
    const env = process.env.NEXT_PUBLIC_ENV;

    if (!env) {
      throw new ConfigError(
        'NEXT_PUBLIC_ENV is required. Set to: local, staging, or production'
      );
    }

    if (!['local', 'staging', 'production'].includes(env)) {
      throw new ConfigError(
        `NEXT_PUBLIC_ENV must be one of: local, staging, production. Got: ${env}`
      );
    }

    return env as 'local' | 'staging' | 'production';
  }

  private _fetchClientSecret(): string {
    // App Runner injects CLIENT_SECRET from Secrets Manager as an env var.
    // For local development, set CLIENT_SECRET in your .env.local file.
    const secret = process.env.CLIENT_SECRET;
    if (!secret) {
      throw new ConfigError(
        'CLIENT_SECRET environment variable is not set. ' +
          'In App Runner it is injected automatically from Secrets Manager. ' +
          'For local development, set it in .env.local.'
      );
    }
    return secret;
  }

  private _getVimBackendUrl(
    env: 'local' | 'staging' | 'production'
  ): string {
    // Allow override
    if (process.env.NEXT_PUBLIC_VIM_BACKEND_URL) {
      return process.env.NEXT_PUBLIC_VIM_BACKEND_URL;
    }

    switch (env) {
      case 'local':
        return 'http://localhost:3000';
      case 'staging':
        return 'https://api.stage.getvim.ai';
      case 'production':
        return 'https://api.getvim.ai';
    }
  }

  private _getAppUrl(env: 'local' | 'staging' | 'production'): string {
    // Allow override
    if (process.env.NEXT_PUBLIC_APP_URL) {
      return process.env.NEXT_PUBLIC_APP_URL;
    }

    // Client-side: use current origin (but this runs server-side)
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }

    switch (env) {
      case 'local':
        return 'http://localhost:8080';
      case 'staging':
        return 'http://localhost:8080'; // Override in deployed env
      case 'production':
        return 'https://demo.getvim.ai';
    }
  }
}

// ============================================================================
// Singleton Export (using global to survive Next.js bundling)
// ============================================================================

// Extend global to store our singleton
declare global {
  // eslint-disable-next-line no-var
  var __configService: ConfigService | undefined;
}

// Use existing instance from global or create new one
// This ensures the same instance is shared across all Next.js chunks
export const configService = global.__configService ?? new ConfigService();

// Store on global for future imports (survives module bundling)
if (!global.__configService) {
  global.__configService = configService;
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Get the validated server configuration
 * Safe to call from anywhere after initialization
 */
export function getServerConfig(): ServerConfig {
  return configService.getConfig();
}

// Initialize configuration on import
configService.initialize();