import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { trimmed } from '../../../platform/contract/wire/text.js';
import { LinesReverted, RunSelection } from './runFiles.js';
import { ASKS_IN_REVIEW } from '../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../platform/contract/wire/place.js';

const place = trimmed(Schema.String.check(Schema.isMinLength(1)));

const FILES_GRAMMAR = `Takes a file or a directory inside the checkout and answers per file how many prose lines went, plus the files that did not lex and the files marked exempt. Never read: what git ignores, \`node_modules\`, and the graph's own directory.
A comment opening with \`!\` and a pragma a tool reads are never rewritten, a file whose first comment marks it exempt stands whole, a text that does not lex is named and left, and nothing is reformatted.
Each file that held prose is written back through the door a typed write goes through and recorded as this session's own change, carried by submit_work like any other; nothing in the graph moves and no gauge re-pins.
A path another session holds uncommitted lines of is left alone under \`linesHeld\` with the sessions to ask, and the rest lands.`;

const SWEPT_PATH = Schema.Struct({ path: Schema.String, dropped: Schema.Int });

export const CHANGE_WRITES = {
  revert_lines: operation('revert_lines', {
    approval: ASKS_IN_REVIEW,
    doors: { socket: true },
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    waits: ['entry-gate'],
    lifetimes: ['workspace'],
    meaning: 'Restore the provably owned, uncommitted lines a thread wrote in the selected runs, preserving every other writer’s bytes.',
    grammar:
      'Each inverse needs an exact recorded chain and a unique standing window. Committed, overwritten and unproven changes stay and are named. A final comparison under typed file-write admission leaves a moved file unchanged. The act records its inverse writes on the target thread and leaves the index untouched.',
    input: RunSelection,
    answer: arms({ reverted: { result: LinesReverted } }),
    refusals: [
      'not-found',
      'root-unproven',
      'file-write-failed',
      'path-outside-tree',
      'graph-path',
      'selection-shape',
      'git-unreadable',
      'git-incomplete',
      'record-unread',
      'project-required',
      'no-record',
      'walk-cut',
    ],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Restore the lines ${input.threadId} wrote in the selected runs?` }),
    confirmLabel: 'Restore lines',
    presentation: { running: 'Restoring owned lines', done: 'Restored owned lines' },
  }),
  strip_comments: operation('strip_comments', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    tool: { capability: 'files', needs: ['shared', 'forbids-comments'] },
    callers: 'thread',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    meaning: 'Strip the prose comments standing under a path, as this session’s own recorded writes, one per file that held any.',
    grammar: FILES_GRAMMAR,
    input: Schema.Struct({
      path: place.annotate({
        ...placeRole('value'),
        description: 'A file or directory inside the checkout, absolute or relative to its root.',
      }),
    }),
    answer: arms({
      swept: {
        path: Schema.String,
        read: Schema.Int,
        dropped: Schema.Int,
        stripped: Schema.Array(SWEPT_PATH),
        unrecorded: Schema.Array(SWEPT_PATH),
        unlexable: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
        exempt: Schema.Array(Schema.String),
        linesHeld: Schema.Array(Schema.Struct({ path: Schema.String, holders: Schema.Array(Schema.String) })),
      },
    }),
    refusals: ['path-outside-tree', 'repository-unread', 'record-unread', 'project-required', 'no-record'],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Strip the standing prose comments under ${input.path}?` }),
    confirmLabel: 'Strip',
    presentation: {
      running: 'Stripping prose comments',
      done: 'Stripped prose comments',
    },
  }),
  record_write: operation('record_write', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: undefined,
    callers: 'thread',
    subject: 'file',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    meaning: 'Record one write a session’s own hook reported, as that session’s change to the checkout.',
    grammar:
      'Answered only through a door that proved the writing session from its signed grant: a call no door proved refuses `session-unproven`. The report lands after the file was written, so a command running beside the write may claim the change first. `before` null records a file born by the write, `after` null one it removed; `key` makes a repeated report of the same write land once. A file outside every registered checkout records nothing and answers `outside`.',
    input: Schema.Struct({
      cwd: Schema.String.annotate(placeRole('value')),
      path: Schema.String.annotate(placeRole('value')),
      before: Schema.NullOr(Schema.String),
      after: Schema.NullOr(Schema.String),
      key: Schema.optional(Schema.String),
    }),
    answer: arms({ recorded: { path: Schema.String }, outside: { path: Schema.String } }),
    refusals: ['session-unproven', 'record-unread'],
    effect: 'write',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: (input) => ({ summary: `Record the reported write of ${input.path}?` }),
    confirmLabel: 'Record',
    presentation: {
      running: 'Recording a reported write',
      done: 'Recorded a reported write',
    },
  }),
};

export const SWEEP_OPERATION: keyof typeof CHANGE_WRITES = 'strip_comments';
export const RECORD_OPERATION: keyof typeof CHANGE_WRITES = 'record_write';
