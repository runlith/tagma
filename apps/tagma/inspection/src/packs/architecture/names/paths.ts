import type { Outline } from '@runlith/code-facts/js';
import { covered, type Reading, report, type Seat } from './reading';
import { isPlural, lastOf, parentOf, sameWord, stemOf, wordsOf } from './words';

const exportedCount = (facts: Outline): number => {
  const names = new Set(facts.exports.map(({ name }) => name));
  const types = new Set(facts.exports.filter(({ kind }) => kind === 'type' || kind === 'interface').map(({ name }) => name));
  let counted = names.size;
  for (const name of names) {
    if (!name.endsWith('Schema') || name.length === 'Schema'.length) continue;
    const typed = name.slice(0, -'Schema'.length);
    if (types.has(`${typed[0]?.toUpperCase() ?? ''}${typed.slice(1)}`) && !names.has(typed)) counted -= 1;
  }
  return counted;
};

const directoryOf = (reading: Reading, seat: Seat): string => {
  const parent = parentOf(seat.local);
  return parent === '' ? lastOf(reading.params.base) : lastOf(parent);
};

const namedAfter = (stem: string, directory: string): boolean => {
  const own = wordsOf(stem).join('');
  const theirs = wordsOf(directory).join('');
  return own !== '' && theirs !== '' && sameWord(own, theirs);
};

export const codeLines = (facts: Outline): number => facts.lines - facts.importLines;

export const fileSignals = (reading: Reading, path: string): void => {
  const { checks } = reading.params;
  const seat = reading.seat(path);
  const stem = stemOf(seat.local);
  const directory = directoryOf(reading, seat);
  const home = seat.home !== undefined && parentOf(seat.local) === seat.home;
  const named = namedAfter(stem, directory);
  if (checks.F1 !== undefined && named && !(home && stem === directory) && !covered(checks.F1.exempt, seat.local)) {
    report(reading, {
      rule: 'F1',
      key: seat.local,
      path,
      line: 1,
      message: `is named after its directory \`${directory}/\``,
      fix: `Rename it by the subject it holds, in words \`${directory}/\` does not already say; only a module's own \`<module>/<module>.ts\` takes its directory's name.`,
    });
  }
  if (checks.F2 !== undefined && !named && !covered(checks.F2.exempt, seat.local)) {
    const first = wordsOf(stem)[0];
    const terms = home ? wordsOf(directory) : [wordsOf(directory).join('')];
    const repeated = first === undefined ? undefined : terms.find((term) => sameWord(first, term));
    if (repeated !== undefined) {
      report(reading, {
        rule: 'F2',
        key: seat.local,
        path,
        line: 1,
        message: `repeats its directory's word \`${repeated}\``,
        fix: `Drop \`${first}\` from its name: \`${directory}/\` already says it.`,
      });
    }
  }
  const { F3, F4, F5 } = checks;
  if (F3 === undefined && F4 === undefined && F5 === undefined) return;
  const facts = reading.facts(path);
  const code = codeLines(facts);
  const words = wordsOf(stem);
  if (F3 !== undefined && words.length === 1 && isPlural(stem) && code > F3.lines && !F3.excluded.some((one) => one.path === seat.local)) {
    report(reading, {
      rule: 'F3',
      key: seat.local,
      path,
      line: 1,
      message: `is named with a one-word plural and holds ${code} lines, over ${F3.lines}`,
      fix: `Rename it by its one subject; where the plural stem is honest, add \`{ path: '${seat.local}', subject: '…', why: '…' }\` to \`checks.F3.excluded\` of the \`names\` inspection in \`tagma.config.ts\`.`,
    });
  }
  if (F4 !== undefined) {
    const allowance = F4.allowances.find((one) => one.path === seat.local);
    const budget = allowance?.lines ?? F4.lines;
    if (code > budget) {
      report(reading, {
        rule: 'F4',
        key: seat.local,
        path,
        line: 1,
        message: `holds ${code} lines outside its imports, over ${budget}`,
        fix: oversized(seat.local, code, allowance !== undefined),
        value: code,
      });
    }
  }
  if (F5 !== undefined) {
    const exported = exportedCount(facts);
    if (exported >= F5.exports) {
      report(reading, {
        rule: 'F5',
        key: seat.local,
        path,
        line: 1,
        message: `exports ${exported} top-level names`,
        fix: `Move the exports of another subject into files of their own names, leaving fewer than ${F5.exports} here.`,
        value: exported,
      });
    }
  }
};

const oversized = (local: string, code: number, allowed: boolean): string =>
  `Decide by the file's shape, never by the count: name the file's main subject and find what is foreign to it. Nothing foreign: ${
    allowed
      ? `raise \`lines\` of its allowance \`{ path: '${local}' }\` to ${code}`
      : `add \`{ path: '${local}', lines: ${code}, why: '<its one subject>' }\``
  } in \`checks.F4.allowances\` of the \`names\` inspection in \`tagma.config.ts\`, its why naming that subject, and land it with the file. Foreign, with an owner and mechanical consumers: move it to that owner in this work, largest first; a small helper moved instead does not count. Foreign, needing a new owner, a spec or rewrites beyond the module, or left after a move: absorb it as debt on this area's debt task, or a new one naming the mix, and take that task right after this work.`;

const honest = (reading: Reading, one: string, other: string): boolean => {
  const home = reading.seat(one).home;
  if (home === undefined) return false;
  const left = parentOf(reading.seat(one).local);
  const right = parentOf(reading.seat(other).local);
  const inside = (directory: string) => directory.startsWith(`${home}/`);
  return left !== right && inside(left) && inside(right);
};

export const directorySignals = (reading: Reading, paths: readonly string[]): void => {
  const { F6, F7 } = reading.params.checks;
  if ((F6 === undefined && F7 === undefined) || paths.length === 0) return;
  const listed = reading.listed();
  if (listed === undefined) {
    for (const path of paths) reading.unjudged.push({ file: path, line: 1, specifier: 'F6 and F7: the tree lists no paths' });
    return;
  }
  const counts = new Map<string, number>();
  const stems = new Map<string, string[]>();
  const keyOf = (path: string) => {
    const seat = reading.seat(path);
    return `${seat.module}:${stemOf(seat.local)}`;
  };
  const wantedDirectories = new Set(paths.map(parentOf));
  const wantedStems = F7 === undefined ? new Set<string>() : new Set(paths.map(keyOf));
  for (const path of listed) {
    const directory = parentOf(path);
    if (F6 !== undefined && wantedDirectories.has(directory)) counts.set(directory, (counts.get(directory) ?? 0) + 1);
    if (F7 === undefined || covered(F7.exempt, reading.seat(path).local)) continue;
    const key = keyOf(path);
    if (!wantedStems.has(key)) continue;
    const held = stems.get(key);
    if (held === undefined) stems.set(key, [path]);
    else held.push(path);
  }
  for (const path of paths) {
    const seat = reading.seat(path);
    const directory = parentOf(path);
    const files = counts.get(directory) ?? 0;
    if (F6 !== undefined && files > F6.files) {
      const local = parentOf(seat.local);
      report(reading, {
        rule: 'F6',
        key: `${local}/ @ ${seat.local}`,
        path,
        line: 1,
        message: `stands among ${files} files at one level of \`${local}/\``,
        fix: `Group the files of \`${local}/\` into concept directories, at most ${F6.files} at one level.`,
      });
    }
    if (F7 === undefined || covered(F7.exempt, seat.local)) continue;
    const key = keyOf(path);
    const clashing = (stems.get(key) ?? []).filter((other) => other !== path && !honest(reading, path, other));
    if (clashing.length === 0) continue;
    report(reading, {
      rule: 'F7',
      key: `${key} @ ${seat.local}`,
      path,
      line: 1,
      message: `shares its stem in one module with ${clashing.map((one) => `\`${reading.seat(one).local}\``).join(', ')}`,
      fix: 'Rename the files sharing the stem by their own subjects, or give each a concept directory of its own inside the module.',
    });
  }
};
