import { tick } from 'svelte';

export async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await tick();
  await Promise.resolve();
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}
