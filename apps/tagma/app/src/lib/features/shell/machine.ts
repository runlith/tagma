import type { PlatformStorage } from '@runlith/layer/Platform';

const KEY = 'tagma.machine';
const UNNAMED = 'your computer';

export function machineName(storage: PlatformStorage): string {
  return storage.getItem(KEY) ?? UNNAMED;
}

export function rememberMachine(storage: PlatformStorage, name: string): void {
  storage.setItem(KEY, name);
}

export function sentenceStart(machine: string): string {
  return machine === UNNAMED ? 'Your computer' : machine;
}
