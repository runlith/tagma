import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Options } from '@runlith/e2e/browser';
import type { WindowBehaviorState } from '../src/contract/state.js';
import type { NoFocusStealReasonCode } from '../src/native/no-focus-steal.js';

interface MinimalExample {
  getState(): Promise<WindowBehaviorState>;
  getMeta(): Promise<{ noFocusStealSupport: { status: 'enabled' | 'disabled'; reasonCode?: NoFocusStealReasonCode } }>;
  hideWindow(): Promise<boolean>;
  revealWindow(): Promise<boolean>;
}

interface OverlayExample {
  getState(): Promise<WindowBehaviorState>;
}

declare global {
  interface Window {
    windowBehaviorExample: MinimalExample;
    windowBehaviorOverlayExample: OverlayExample;
  }
}

export const example = (entry: string): Options => ({
  lanes: ['electron'],
  headed: true,
  electron: () => ({
    executablePath: createRequire(import.meta.url)('electron') as string,
    args: [resolve(import.meta.dir, '../examples', entry, 'main.mjs')],
    cwd: resolve(import.meta.dir, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  }),
});
