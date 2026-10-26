import type { PlatformStorage } from '@runlith/layer/Platform';
import type { Router } from '@runlith/layer/Router';
import type { WorkerPort } from '$lib/shared/workers/ServiceWorkers.js';

export const SHELL_CHOICES = ['automatic', 'mobile', 'desktop'] as const;

export type ShellChoice = (typeof SHELL_CHOICES)[number];

const KEY = 'tagma.shell';

export function storedShell(storage: PlatformStorage): ShellChoice {
  const stored = storage.getItem(KEY);
  return stored === 'mobile' || stored === 'desktop' ? stored : 'automatic';
}

export async function chooseShell(
  storage: PlatformStorage,
  workers: WorkerPort,
  router: Router,
  choice: ShellChoice,
  touch: boolean,
): Promise<void> {
  if (choice === storedShell(storage)) return;
  if (choice === 'automatic') storage.removeItem(KEY);
  else storage.setItem(KEY, choice);
  if (!mobileShell(choice, touch)) await workers.unregister();
  router.reload();
}

export function mobileShell(choice: ShellChoice, touch: boolean): boolean {
  return choice === 'mobile' || (choice === 'automatic' && touch);
}
