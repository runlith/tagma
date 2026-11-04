import { stat } from 'node:fs/promises';
import { failed, type Failure, type Platform, type Preparation } from '../contract/platform.js';

const HELPERS = ['/opt/google/chrome/chrome-sandbox', '/usr/lib/chromium/chrome-sandbox', '/usr/lib/chromium/chrome_sandbox'];
const SANDBOX = /No usable sandbox|SUID sandbox helper|Failed to move to new namespace|Running as root without --no-sandbox/u;
const DISPLAY = /Missing X server|\$DISPLAY|cannot open display|Failed to initialize.*(?:Ozone|Wayland|X11)/iu;
const LIBRARY = /error while loading shared libraries:\s*([^:\s]+)/u;

const sandbox = (message: string): Failure => ({
  _tag: 'LaunchRefused',
  problem: 'sandbox-unavailable',
  message,
  unblock: [
    'permit user namespaces for this executable in the Linux security policy, or install a root-owned mode-4755 Chromium sandbox helper and set CHROME_DEVEL_SANDBOX to its path',
    'correct or unset CHROME_DEVEL_SANDBOX if it names an unsuitable helper',
    'Chromium sandbox setup: https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md',
  ],
});

const display = (message: string): Failure => ({
  _tag: 'LaunchRefused',
  problem: 'display-unavailable',
  message,
  unblock: ['start the browser from an X11 or Wayland desktop session with DISPLAY or WAYLAND_DISPLAY set'],
});

export const makePlatform = (environment: NodeJS.ProcessEnv): Platform => ({
  prepare: async (windowed): Promise<Preparation> => {
    if (windowed && !environment.DISPLAY && !environment.WAYLAND_DISPLAY)
      return display('a windowed browser needs an X11 or Wayland display, but neither DISPLAY nor WAYLAND_DISPLAY is set');
    if (process.getuid?.() === 0)
      return {
        _tag: 'LaunchRefused',
        problem: 'sandbox-unavailable',
        message: 'Chromium cannot use its sandbox when started as root',
        unblock: ['start the browser as an unprivileged user'],
      };
    const explicit = environment.CHROME_DEVEL_SANDBOX;
    const candidates = explicit === undefined ? HELPERS : explicit === '' ? [] : [explicit];
    for (const helper of candidates) {
      try {
        const file = await stat(helper);
        if (file.isFile() && file.uid === 0 && (file.mode & 0o7777) === 0o4755)
          return { _tag: 'Ready', environment: { ...environment, CHROME_DEVEL_SANDBOX: helper } };
        if (explicit !== undefined)
          return sandbox(`the configured Chromium sandbox helper ${helper} is not a root-owned regular file with mode 4755`);
      } catch (failure) {
        if (failure instanceof Error && 'code' in failure) {
          if (explicit === undefined && (failure.code === 'ENOENT' || failure.code === 'EACCES' || failure.code === 'EPERM')) continue;
          if (failure.code === 'ENOENT') return sandbox(`the configured Chromium sandbox helper ${helper} does not exist`);
        }
        return sandbox(`the Chromium sandbox helper ${helper} could not be inspected: ${String(failure)}`);
      }
    }
    return { _tag: 'Ready', environment: { ...environment } };
  },
  failed: (diagnostic) => {
    if (/SUID sandbox helper/u.test(diagnostic))
      return {
        ...sandbox(`the Linux browser sandbox is unavailable:\n${diagnostic}`),
        unblock: [
          'configure the executable-adjacent chrome-sandbox named above as root-owned with mode 4755, or permit user namespaces for this executable; CHROME_DEVEL_SANDBOX does not override an adjacent helper',
          'Chromium sandbox setup: https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md',
        ],
      };
    if (SANDBOX.test(diagnostic)) return sandbox(`the Linux browser sandbox is unavailable:\n${diagnostic}`);
    if (DISPLAY.test(diagnostic)) return display(`the browser could not reach the Linux display:\n${diagnostic}`);
    const library = LIBRARY.exec(diagnostic)?.[1];
    if (library !== undefined)
      return {
        _tag: 'LaunchRefused',
        problem: 'libraries-unavailable',
        message: `the browser's native libraries are unavailable:\n${diagnostic}`,
        unblock: [`install the Linux package providing ${library}, then start the browser again`],
      };
    return failed(diagnostic);
  },
});
