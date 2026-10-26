export const ORIGINAL = Symbol.for('runlith.testbed.original');

let depth = 0;

export const quiet = (): boolean => depth > 0;

export const quietly = <T>(work: () => T): T => {
  depth += 1;
  try {
    return work();
  } finally {
    depth -= 1;
  }
};

export const pristine = <F extends (...args: never[]) => unknown>(fn: F): F => {
  const original = ((fn as unknown as Record<symbol, unknown>)[ORIGINAL] ?? fn) as F;
  return ((...args: Parameters<F>) => quietly(() => original(...args))) as F;
};
