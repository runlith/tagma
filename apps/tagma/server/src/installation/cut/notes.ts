import { Data, Effect } from 'effect';
import { Git } from '@runlith/git/Git';

export class NotesUnreadable extends Data.TaggedError('NotesUnreadable')<{ readonly detail: string }> {}

const SECTIONS = [
  { type: 'feat', title: 'Features' },
  { type: 'fix', title: 'Fixes' },
  { type: 'perf', title: 'Performance' },
] as const;

const SUBJECT = /^(feat|fix|perf)(?:\(([^()\r\n]*)\))?(!)?: (\S.*)$/u;
const TASK = /^Task: (\S.*)$/u;
const BREAKING = /^BREAKING[ -]CHANGE: (\S.*)$/u;
const RECORD = '\u001e';
const FIELD = '\u001f';

type Entry = {
  readonly type: (typeof SECTIONS)[number]['type'];
  readonly scope: string | null;
  readonly subject: string;
  readonly breaking: boolean;
  readonly reasons: readonly string[];
  readonly tasks: readonly string[];
};

const entryOf = (record: string): Entry | null => {
  const [subject = '', body = ''] = record.split(FIELD);
  const matched = SUBJECT.exec(subject.trim());
  if (matched === null) return null;
  const lines = body.split(/\r?\n/u).map((line) => line.trimEnd());
  const reasons = lines.flatMap((line) => BREAKING.exec(line)?.[1] ?? []);
  return {
    type: matched[1] as Entry['type'],
    scope: matched[2] === undefined || matched[2] === '' ? null : matched[2],
    subject: matched[4]!,
    breaking: matched[3] !== undefined || reasons.length > 0,
    reasons,
    tasks: lines.flatMap((line) => TASK.exec(line)?.[1] ?? []),
  };
};

const lines = (entry: Entry): string =>
  [
    `- ${entry.scope === null ? '' : `**${entry.scope}:** `}${entry.subject}`,
    ...entry.reasons.map((reason) => `  ${reason}`),
    ...entry.tasks.map((task) => `  - Task: ${task}`),
  ].join('\n');

export const notesOf = (log: string): string => {
  const entries = log
    .split(RECORD)
    .map(entryOf)
    .filter((entry) => entry !== null);
  const breaking = entries.filter((entry) => entry.breaking);
  const sections = [
    { title: 'BREAKING CHANGES', entries: breaking },
    ...SECTIONS.map(({ type, title }) => ({ title, entries: entries.filter((entry) => !entry.breaking && entry.type === type) })),
  ];
  return sections
    .filter((section) => section.entries.length > 0)
    .map((section) => `## ${section.title}\n\n${section.entries.map(lines).join('\n')}`)
    .join('\n\n');
};

export const releaseNotes = Effect.fn('installation.releaseNotes')(function* (
  checkout: string,
  base: string | null,
  commit: string,
): Effect.fn.Return<string, NotesUnreadable, Git> {
  const git = yield* Git;
  const answer = yield* git
    .run(
      [
        'log',
        '--no-merges',
        `--format=${RECORD}%s${FIELD}%b`,
        base === null ? commit : `refs/tags/${base}..${commit}`,
        '--',
        ':(top)',
        ':(top,exclude).tagma',
      ],
      { cwd: checkout },
    )
    .pipe(Effect.mapError((failure) => new NotesUnreadable({ detail: failure.message })));
  if (answer.status !== 0) {
    return yield* new NotesUnreadable({ detail: `git log exited ${answer.status}: ${answer.stderr.trim()}` });
  }
  return notesOf(answer.stdout);
});
