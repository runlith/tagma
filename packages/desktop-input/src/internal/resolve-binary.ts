import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BINARY_NAME = 'runlith-desktop-input';

function packageRoot(moduleUrl: string): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const candidates = [join(moduleDir, '..', '..'), join(moduleDir, '..')];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'bin', BINARY_NAME))) return candidate;
  }
  return candidates[0] ?? moduleDir;
}

export function resolveDesktopInputBinary(moduleUrl: string): string | null {
  const candidate = join(packageRoot(moduleUrl), 'bin', BINARY_NAME);
  if (!existsSync(candidate)) return null;

  try {
    accessSync(candidate, constants.X_OK);
    return candidate;
  } catch {
    try {
      chmodSync(candidate, 0o755);
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      return null;
    }
  }
}
