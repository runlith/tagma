import { fileURLToPath } from 'node:url';

export function addonPath(): string {
  return fileURLToPath(new URL('../../native/build/Release/window_behavior_native.node', import.meta.url));
}
