import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { DesktopAccessibilityState } from './contract/types.js';
import { parseSidecarLine } from './internal/protocol.js';
import { resolveDesktopInputBinary } from './internal/resolve-binary.js';

const PREFLIGHT_TIMEOUT_MS = 3_000;

export function preflightDesktopInputAccessibility(binaryPathOverride?: string): Promise<DesktopAccessibilityState | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);

  const binaryPath = binaryPathOverride ?? resolveDesktopInputBinary(import.meta.url);
  if (!binaryPath) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: DesktopAccessibilityState | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      child.kill('SIGTERM');
    };

    const child = spawn(binaryPath, ['--preflight-accessibility'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      const message = parseSidecarLine(line);
      if (message?.kind === 'accessibility') {
        finish({ trusted: message.data.trusted, tapActive: message.data.tapActive });
      }
    });

    const timeout = setTimeout(() => finish(null), PREFLIGHT_TIMEOUT_MS);
    timeout.unref?.();
  });
}
