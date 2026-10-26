export function watch<T>(read: () => T): { seen: T[]; stop: () => void } {
  const seen: T[] = [];

  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(read());
    });
  });

  return { seen, stop };
}
