import { timeAgo } from '$lib/shared/time.js';

export function recapAge(generatedAt: string, now: number): string {
  const age = timeAgo(generatedAt, now);
  if (age === 'now') return 'just now';
  return /^\d+[mhd]$/.test(age) ? `${age} ago` : age;
}
