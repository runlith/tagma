import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';

export function warmthAt(warmth: ThreadCacheWarmth, now: () => number): ThreadCacheWarmth['state'] {
  if (warmth.basis !== 'promise' || warmth.expiresAt === null) return warmth.state;
  return now() < Date.parse(warmth.expiresAt) ? 'warm' : 'cold';
}

export function warmthFilled(warmth: ThreadCacheWarmth | null, now: () => number): boolean {
  if (warmth === null) return false;
  const state = warmthAt(warmth, now);
  return state === 'warm' || state === 'likely';
}

function minutesWord(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const INVALIDATED_SINCE: Record<NonNullable<ThreadCacheWarmth['invalidatedBy']>, string> = {
  compaction: 'compacted since',
  rewind: 'rewound since',
  selection: 'model changed since',
  account: 'account changed since',
  reasoning: 'reasoning changed since',
};

export function warmthWords(warmth: ThreadCacheWarmth, vendor: string, now: () => number): string {
  if (warmth.invalidatedBy !== null) return `${warmth.state} · ${INVALIDATED_SINCE[warmth.invalidatedBy]}`;
  if (warmth.basis === 'promise' && warmth.expiresAt !== null) {
    const left = Date.parse(warmth.expiresAt) - now();
    return left > 0 ? `warm · ${minutesWord(left)} left · promised by ${vendor}` : `cold · window passed ${minutesWord(left)} ago`;
  }
  if ((warmth.basis === 'local' || warmth.basis === 'prior') && warmth.warmShare !== null) {
    const share = `${Math.round(warmth.warmShare * 100)}%`;
    return `${warmth.state} · ${share} of ${warmth.sample ?? 0} · ${warmth.basis === 'local' ? 'your data' : 'prior'}`;
  }
  return `${warmth.state} · no figure`;
}

const COLD_BY: Record<NonNullable<ThreadCacheWarmth['invalidatedBy']>, string> = {
  compaction: 'compacted',
  rewind: 'rewound',
  selection: 'model changed',
  account: 'account changed',
  reasoning: 'reasoning changed',
};

export function cacheWord(warmth: ThreadCacheWarmth, now: () => number): string {
  if (warmth.invalidatedBy !== null) return `cold, ${COLD_BY[warmth.invalidatedBy]}`;
  if (warmth.basis === 'promise' && warmth.expiresAt !== null) {
    const left = Date.parse(warmth.expiresAt) - now();
    return left > 0 ? `warm, ${minutesWord(left)} left` : `cold for ${minutesWord(left)}`;
  }
  if ((warmth.basis === 'local' || warmth.basis === 'prior') && warmth.warmShare !== null) {
    return `${Math.round(warmth.warmShare * 100)}% chance warm`;
  }
  return 'unknown';
}
