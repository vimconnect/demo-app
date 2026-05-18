import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildClientConfig, getConfig } from '../../lib/client-config';

describe('buildClientConfig', () => {
  afterEach(() => {
    delete process.env.CLIENT_ID;
    delete process.env.APP_ENV;
  });

  it('throws if CLIENT_ID is missing', () => {
    expect(() => buildClientConfig()).toThrow('CLIENT_ID is required');
  });

  it('throws if APP_ENV is invalid', () => {
    process.env.CLIENT_ID = 'test-client';
    process.env.APP_ENV = 'invalid';
    expect(() => buildClientConfig()).toThrow('Invalid APP_ENV: invalid');
  });

  it('reads CLIENT_ID and APP_ENV', () => {
    process.env.CLIENT_ID = 'my-client-id';
    process.env.APP_ENV = 'production';
    const config = buildClientConfig();
    expect(config.clientId).toBe('my-client-id');
    expect(config.env).toBe('production');
  });

  it('defaults APP_ENV to staging when unset', () => {
    process.env.CLIENT_ID = 'my-client-id';
    const config = buildClientConfig();
    expect(config.env).toBe('staging');
  });

  it('output is safe for JSON serialization in dangerouslySetInnerHTML', () => {
    process.env.CLIENT_ID = 'test-client';
    process.env.APP_ENV = 'staging';
    const config = buildClientConfig();
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/<script/i);
    expect(serialized).not.toMatch(/<\/script>/i);
    expect(serialized).not.toMatch(/&lt;|&gt;|&amp;|&quot;|&#/);
    expect(JSON.parse(serialized)).toEqual(config);
  });
});

describe('getConfig', () => {
  afterEach(() => {
    delete process.env.CLIENT_ID;
    delete process.env.APP_ENV;
    vi.restoreAllMocks();
  });

  it('calls buildClientConfig on server (no window)', () => {
    process.env.CLIENT_ID = 'server-client';
    process.env.APP_ENV = 'staging';
    // jsdom provides window, so we temporarily remove it
    const originalWindow = global.window;
    // @ts-expect-error — intentionally removing window to simulate server
    delete global.window;
    try {
      const config = getConfig();
      expect(config.clientId).toBe('server-client');
    } finally {
      global.window = originalWindow;
    }
  });

  it('reads window.__CONFIG__ on client', () => {
    const injected = { clientId: 'client-id', env: 'production' as const };
    (window as Window & { __CONFIG__?: typeof injected }).__CONFIG__ = injected;
    try {
      const config = getConfig();
      expect(config).toEqual(injected);
    } finally {
      delete (window as Window & { __CONFIG__?: typeof injected }).__CONFIG__;
    }
  });

  it('throws on client when window.__CONFIG__ is missing', () => {
    delete (window as Window & { __CONFIG__?: unknown }).__CONFIG__;
    expect(() => getConfig()).toThrow('window.__CONFIG__ is not injected');
  });
});
