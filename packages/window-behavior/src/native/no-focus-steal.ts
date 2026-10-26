import { createRequire } from 'node:module';
import type { NoFocusStealAdapter } from '../host-electron/types.js';
import { addonPath as nativeAddonPath } from './addon-path.js';

const require = createRequire(import.meta.url);

export type NoFocusStealMode = 'auto' | 'required' | 'off';

export type NoFocusStealReasonCode = 'disabled-by-mode' | 'unsupported-platform' | 'addon-missing' | 'load-failed' | 'invalid-addon-shape';

export interface NoFocusStealAddon {
  setPreventsActivation(handle: Buffer, enabled: boolean): boolean;
}

export interface NoFocusStealSupportOptions {
  mode?: NoFocusStealMode;
  platform?: NodeJS.Platform;
  addonPath?: string;
  loadModule?: (addonPath: string) => unknown;
}

export interface NoFocusStealSupportEnabled {
  mode: NoFocusStealMode;
  status: 'enabled';
  supportedPlatform: true;
  addonPath: string;
  adapter: NoFocusStealAdapter;
  reasonCode?: undefined;
  reason?: undefined;
}

export interface NoFocusStealSupportDisabled {
  mode: NoFocusStealMode;
  status: 'disabled';
  supportedPlatform: boolean;
  addonPath: string;
  adapter?: undefined;
  reasonCode: NoFocusStealReasonCode;
  reason: string;
}

export type NoFocusStealSupport = NoFocusStealSupportEnabled | NoFocusStealSupportDisabled;

export class NoFocusStealSupportError extends Error {
  readonly resolution: NoFocusStealSupportDisabled;

  constructor(message: string, resolution: NoFocusStealSupportDisabled) {
    super(message);
    this.name = 'NoFocusStealSupportError';
    this.resolution = resolution;
  }
}

export function isNoFocusStealAddon(value: unknown): value is NoFocusStealAddon {
  if (!value || typeof value !== 'object') return false;

  return typeof Reflect.get(value, 'setPreventsActivation') === 'function';
}

export function createNoFocusStealAdapter(addon: NoFocusStealAddon): NoFocusStealAdapter {
  return {
    setPreventsActivation(window, enabled) {
      try {
        return addon.setPreventsActivation(window.getNativeWindowHandle(), enabled);
      } catch {
        return false;
      }
    },
  };
}

export function resolveNoFocusStealSupport(options?: NoFocusStealSupportOptions): NoFocusStealSupport {
  const mode = options?.mode ?? 'auto';
  const platform = options?.platform ?? process.platform;
  const addonPath = options?.addonPath ?? nativeAddonPath();
  const loadModule = options?.loadModule ?? defaultLoadModule;

  if (mode === 'off') {
    return createDisabledSupport({
      mode,
      supportedPlatform: platform === 'darwin',
      addonPath,
      reasonCode: 'disabled-by-mode',
      reason: 'Native no-focus-steal support was disabled explicitly.',
    });
  }

  if (platform !== 'darwin') {
    const support = createDisabledSupport({
      mode,
      supportedPlatform: false,
      addonPath,
      reasonCode: 'unsupported-platform',
      reason: `Native no-focus-steal support is only available on macOS. Current platform: ${platform}.`,
    });

    if (mode === 'required') {
      throw new NoFocusStealSupportError(support.reason, support);
    }

    return support;
  }

  let loaded: unknown;

  try {
    loaded = loadModule(addonPath);
  } catch (error) {
    const support = createDisabledSupport({
      mode,
      supportedPlatform: true,
      addonPath,
      reasonCode:
        error instanceof Error && /\bCannot find module\b|\bMODULE_NOT_FOUND\b/.test(error.message) ? 'addon-missing' : 'load-failed',
      reason: error instanceof Error ? error.message : 'Unknown error while loading the native no-focus-steal addon.',
    });

    if (mode === 'required') {
      throw new NoFocusStealSupportError(support.reason, support);
    }

    return support;
  }

  if (!isNoFocusStealAddon(loaded)) {
    const support = createDisabledSupport({
      mode,
      supportedPlatform: true,
      addonPath,
      reasonCode: 'invalid-addon-shape',
      reason: 'Native no-focus-steal addon loaded, but it does not expose setPreventsActivation(handle, enabled).',
    });

    if (mode === 'required') {
      throw new NoFocusStealSupportError(support.reason, support);
    }

    return support;
  }

  return {
    mode,
    status: 'enabled',
    supportedPlatform: true,
    addonPath,
    adapter: createNoFocusStealAdapter(loaded),
  };
}

function createDisabledSupport(input: {
  mode: NoFocusStealMode;
  supportedPlatform: boolean;
  addonPath: string;
  reasonCode: NoFocusStealReasonCode;
  reason: string;
}): NoFocusStealSupportDisabled {
  return {
    mode: input.mode,
    status: 'disabled',
    supportedPlatform: input.supportedPlatform,
    addonPath: input.addonPath,
    reasonCode: input.reasonCode,
    reason: input.reason,
  };
}

function defaultLoadModule(addonPath: string): unknown {
  return require(addonPath);
}
