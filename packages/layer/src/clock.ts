import type { Scope } from './Scope.js';

export const Clock = {
  now(): number {
    return Date.now();
  },

  after(scope: Scope, ms: number, run: () => void): () => void {
    scope.assertOpen();
    const id = setTimeout(() => {
      scope.signal.removeEventListener('abort', cancel);
      run();
    }, ms);
    const cancel = () => clearTimeout(id);
    scope.signal.addEventListener('abort', cancel, { once: true });
    return () => {
      scope.signal.removeEventListener('abort', cancel);
      cancel();
    };
  },

  every(scope: Scope, ms: number, run: () => void): () => void {
    scope.assertOpen();
    const id = setInterval(run, ms);
    const cancel = () => clearInterval(id);
    scope.signal.addEventListener('abort', cancel, { once: true });
    return () => {
      scope.signal.removeEventListener('abort', cancel);
      cancel();
    };
  },
} as const;
