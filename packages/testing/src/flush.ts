import { tick } from 'svelte';

export async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await tick();
  await Promise.resolve();
}

export async function waitUntil(reached: () => boolean): Promise<void> {
  while (!reached()) await new Promise<void>((resolve) => setTimeout(resolve, 1));
}

export async function waitFor<T>(read: () => T | Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await read();
    } catch (cause) {
      if (!(cause instanceof Error) || cause.name !== 'AssertionError') throw cause;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}
