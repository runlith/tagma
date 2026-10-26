const HANDS = ['var(--hand-1)', 'var(--hand-2)', 'var(--hand-3)', 'var(--hand-4)'] as const;

function slotOf(threadId: string): number {
  let hash = 2166136261;
  for (let at = 0; at < threadId.length; at += 1) {
    hash ^= threadId.charCodeAt(at);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % HANDS.length;
}

export function handHues(threads: readonly { readonly threadId: string }[]): ReadonlyMap<string, string> {
  const taken = new Set<number>();
  const hues = new Map<string, string>();
  for (const thread of threads) {
    if (hues.has(thread.threadId)) continue;
    let slot = slotOf(thread.threadId);
    for (let step = 0; step < HANDS.length && taken.has(slot); step += 1) slot = (slot + 1) % HANDS.length;
    taken.add(slot);
    hues.set(thread.threadId, HANDS[slot] as string);
  }
  return hues;
}
