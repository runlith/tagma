export const rested = (): Worker => new Worker(new URL('./rested.worker.ts', import.meta.url), { type: 'module' });
