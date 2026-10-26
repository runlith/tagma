import { type Match, scoreName } from '@runlith/search-text/match';

const IN_NAME = 100;
const WHOLE_STEM = 100;
const SHORTER = 0.02;

export function matchPath(words: readonly string[], path: string, folded: string, recentRank: number): Match | null {
  const nameAt = path.lastIndexOf('/') + 1;
  const name = path.slice(nameAt);
  const foldedName = folded.slice(nameAt);
  const dot = foldedName.lastIndexOf('.');
  const stem = dot > 0 ? foldedName.slice(0, dot) : foldedName;
  let total = 0;
  const positions = new Set<number>();
  for (const word of words) {
    const own = word.includes('/') ? null : scoreName(word, name, foldedName);
    if (own !== null) {
      total += IN_NAME + own.score + (stem === word ? WHOLE_STEM : 0);
      for (const at of own.positions) positions.add(nameAt + at);
      continue;
    }
    const along = scoreName(word, path, folded, false);
    if (along === null) return null;
    total += along.score;
    for (const at of along.positions) positions.add(at);
  }
  const boost = recentRank < 0 ? 0 : 40 - Math.min(30, recentRank * 0.5);
  return { score: total + boost - path.length * SHORTER, positions: [...positions].sort((left, right) => left - right) };
}
