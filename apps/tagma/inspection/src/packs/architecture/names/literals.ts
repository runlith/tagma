import type { TagLiteral } from '@runlith/code-facts/js';
import { covered, type Reading, report } from './reading';

export const literalSignals = (reading: Reading, path: string): void => {
  const entries = reading.params.checks.literals ?? [];
  if (entries.length === 0) return;
  const seat = reading.seat(path);
  const applying = entries.filter((one) => covered(one.region, seat.local) && !covered(one.allowIn, seat.local));
  if (applying.length === 0) return;
  const groups = new Map<string, { readonly first: TagLiteral; count: number }>();
  for (const literal of reading.facts(path).literals) {
    if (!applying.some((one) => one.words.includes(literal.value) && one.positions.includes(literal.position))) continue;
    const key = `${seat.local} '${literal.value}' ${literal.position}`;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { first: literal, count: 1 });
    else held.count += 1;
  }
  for (const [key, { first, count }] of groups) {
    const allowIn = [
      ...new Set(
        applying.filter((one) => one.words.includes(first.value) && one.positions.includes(first.position)).flatMap((one) => one.allowIn),
      ),
    ];
    report(reading, {
      rule: 'literal',
      key,
      path,
      line: first.line,
      message: `the tag \`'${first.value}'\` is written in a ${first.position} position beside \`${first.near}\`${count === 1 ? '' : ` (${count} times)`}`,
      fix: `Ask the owner of \`'${first.value}'\` for what it decides instead of naming the tag here${allowIn.length === 0 ? '' : `, or move this code under ${allowIn.map((glob) => `\`${glob}\``).join(', ')}`}.`,
      value: count,
    });
  }
};
