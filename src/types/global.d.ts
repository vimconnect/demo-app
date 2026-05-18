import type { ClientConfig } from '../lib/client-config';

declare global {
  interface Window {
    __CONFIG__?: ClientConfig;
  }
}
