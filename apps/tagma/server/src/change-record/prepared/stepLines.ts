import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { PreparedLineHolders } from '../contract/service/prepared.js';
import { runGit, type OwnGitFailed } from '../../platform/git/ownGit.js';

export type StepHunk = { readonly oldStart: number; readonly oldCount: number; readonly newStart: number; readonly newCount: number };

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const count = (text: string | undefined): number => (text === undefined ? 1 : Number(text));

const ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

const unquoted = (name: string): string => {
  if (!name.startsWith('"') || !name.endsWith('"') || name.length < 2) return name;
  const bytes: number[] = [];
  const body = name.slice(1, -1);
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at] as string;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(at + 1));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      at += 3;
      continue;
    }
    bytes.push(ESCAPES[body[at + 1] as string] ?? (body[at + 1] as string).charCodeAt(0));
    at += 1;
  }
  return Buffer.from(bytes).toString('utf8');
};

export const hunksOf = (patch: string): ReadonlyMap<string, readonly StepHunk[]> => {
  const files = new Map<string, StepHunk[]>();
  let current: StepHunk[] | null = null;
  let old = 0;
  let added = 0;
  for (const line of patch.split('\n')) {
    if (old > 0 && line.startsWith('-')) {
      old -= 1;
      continue;
    }
    if (added > 0 && line.startsWith('+')) {
      added -= 1;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const name = unquoted(line.slice(4).replace(/\t$/, ''));
      current = name === '/dev/null' ? null : [];
      if (current !== null) files.set(name.startsWith('b/') ? name.slice(2) : name, current);
      continue;
    }
    const header = HEADER.exec(line);
    if (header === null || current === null) continue;
    const hunk = { oldStart: Number(header[1]), oldCount: count(header[2]), newStart: Number(header[3]), newCount: count(header[4]) };
    current.push(hunk);
    old = hunk.oldCount;
    added = hunk.newCount;
  }
  return files;
};

export const through =
  (hunks: ReadonlyMap<string, readonly StepHunk[]>, holders: PreparedLineHolders): PreparedLineHolders =>
  (lines) =>
    Effect.map(
      holders(lines.flatMap(({ file, line }) => sourceLines(hunks.get(file) ?? [], line).map((source) => ({ file, line: source })))),
      (answers) => {
        let at = 0;
        return lines.map(({ file, line }) => {
          const sources = sourceLines(hunks.get(file) ?? [], line).length;
          const mine = answers.slice(at, at + sources);
          at += sources;
          const [first, ...rest] = mine;
          return first === undefined ? [] : first.filter((holder) => rest.every((other) => other.includes(holder)));
        });
      },
    );

export const sourceLines = (hunks: readonly StepHunk[], line: number): readonly number[] => {
  let shift = 0;
  for (const hunk of hunks) {
    const first = hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart;
    if (line < first) break;
    if (hunk.newCount > 0 && line < hunk.newStart + hunk.newCount) {
      return Array.from({ length: hunk.oldCount }, (_, at) => hunk.oldStart + at);
    }
    shift += hunk.newCount - hunk.oldCount;
  }
  return [line - shift];
};

export const stepHunks = (
  git: Git['Service'],
  root: string,
  from: string,
  to: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly StepHunk[]>, OwnGitFailed> =>
  Effect.map(
    runGit(
      git,
      'submit-step-hunks',
      [
        '-C',
        root,
        'diff-tree',
        '-p',
        '-U0',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        from,
        to,
        '--',
        ...paths,
      ],
      { env: { GIT_LITERAL_PATHSPECS: '1' } },
    ),
    hunksOf,
  );
