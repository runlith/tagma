import { describe, expect, test } from 'bun:test';
import { createNoFocusStealAdapter, NoFocusStealSupportError, resolveNoFocusStealSupport } from './no-focus-steal.js';
import { addonPath } from './addon-path.js';

describe('window behavior native support', () => {
  test('builds an Electron adapter from a loaded addon', () => {
    const calls: Array<{ handle: Buffer; enabled: boolean }> = [];
    const adapter = createNoFocusStealAdapter({
      setPreventsActivation(handle, enabled) {
        calls.push({ handle, enabled });
        return enabled;
      },
    });
    const handle = Buffer.from('handle');
    const window = {
      getNativeWindowHandle() {
        return handle;
      },
    };

    const result = adapter.setPreventsActivation(window, true);

    expect(result).toBe(true);
    expect(calls).toEqual([{ handle, enabled: true }]);
  });

  test('degrades to false when the native addon throws during activation', () => {
    const adapter = createNoFocusStealAdapter({
      setPreventsActivation() {
        throw new Error('native failure');
      },
    });

    const result = adapter.setPreventsActivation(
      {
        getNativeWindowHandle() {
          return Buffer.from('handle');
        },
      },
      true,
    );

    expect(result).toBe(false);
  });

  test('skips loading when native support is disabled explicitly', () => {
    let loadCalls = 0;

    const support = resolveNoFocusStealSupport({
      mode: 'off',
      platform: 'darwin',
      loadModule() {
        loadCalls += 1;
        return undefined;
      },
    });

    expect(support.status).toBe('disabled');
    expect(support.reasonCode).toBe('disabled-by-mode');
    expect(loadCalls).toBe(0);
  });

  test('returns disabled support on unsupported platforms in auto mode', () => {
    const support = resolveNoFocusStealSupport({
      platform: 'linux',
    });

    expect(support.status).toBe('disabled');
    expect(support.reasonCode).toBe('unsupported-platform');
  });

  test('loads the addon in auto mode when the addon shape is valid', () => {
    const support = resolveNoFocusStealSupport({
      platform: 'darwin',
      addonPath: '/virtual/addon.node',
      loadModule(addonPath) {
        expect(addonPath).toBe('/virtual/addon.node');
        return {
          setPreventsActivation() {
            return true;
          },
        };
      },
    });

    expect(support.status).toBe('enabled');
    expect(support.adapter).toBeDefined();
  });

  test('throws in required mode when the addon is missing', () => {
    expect(() =>
      resolveNoFocusStealSupport({
        mode: 'required',
        platform: 'darwin',
        loadModule() {
          throw new Error('Cannot find module /virtual/addon.node');
        },
      }),
    ).toThrow(NoFocusStealSupportError);
  });

  test('resolves the package-local native addon path', () => {
    expect(addonPath()).toContain('packages/window-behavior/native/build/Release/window_behavior_native.node');
  });
});
