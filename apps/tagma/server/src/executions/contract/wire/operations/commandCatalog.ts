import { Schema } from 'effect';
import { type Raised } from '@runlith/agent/permissions';
import { COMMAND_LIFE } from '@runlith/agent-tools/CommandWork';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import { ByteOffset } from '@runlith/executions/protocol/record';
import {
  COMMAND_ORDERS,
  CommandListAnswer,
  CommandOutputReading,
  CommandReading,
  CommandSearchReading,
  OUTPUT_COLUMNS,
  OUTPUT_STREAMS,
} from '../commands.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { executionReads, executionShapes, executionWrites, OPERATOR_DOORS } from './shape.js';
import { ByteChunk, CommandLimitChanged, ExecutionStopped } from '../operationAnswers.js';
import { family, PAGE_CURSOR } from '@runlith/paging';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { OUTPUT_RETAINED_BYTES } from '../terminalBehavior.js';
import { COMMAND_CEILING } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const { read, requestWrite } = executionShapes({ capability: 'shell', needs: ['shared'] });

export const COMMANDS = family('commands', 1, 'text', { text: 475, json: 3046 }, 100, () => ({
  execution: 'exec-1',
  label: 'x'.repeat(60),
  command: 'x'.repeat(200),
  cwd: `/${'x'.repeat(22)}`,
  ending: 'exit 0',
}));

export const OUTPUT_MATCHES = family('output-matches', 1, 'text', { text: 520, json: 700 }, 50, () => ({
  stream: 'stdout',
  line: 123_456,
  offset: '8388608',
  text: 'x'.repeat(OUTPUT_COLUMNS),
  before: [],
  after: [],
}));

const contextLines = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 }));

const execution = Schema.NonEmptyString.annotate({ description: 'The execution id.' });
const incarnation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description:
    'The host generation this execution belongs to. A replacement host restarts at a new one, so a reference carrying an old one addresses nothing and is answered as such.',
});

const cursor = Schema.NonEmptyString.annotate({
  description: 'The cursor the previous page answered with, unchanged. It carries its own selection; a changed one refuses.',
});

const operationId = Schema.NonEmptyString.annotate({
  description:
    'Your own name for this mutation, chosen BEFORE the call and kept. The same name answers the same act; it never runs a second one.',
});

const order = Schema.Literals(COMMAND_ORDERS).annotate({
  description:
    'Which end of the admission order the page is taken from: `oldest` (the default) from the beginning, `newest` from the end. A cursor is continued only in the direction it was taken in; `after` names the position before the next page in `oldest` and the position after it in `newest`.',
});

const stopCommandConsequence = (input: { readonly action?: 'signal' | 'destroy' }): string =>
  input.action === 'destroy'
    ? 'It ends ONE command and never its agent. Destroying may abandon output the kernel has not yet handed over, and the receipt names three populations of which only the first is a completion.'
    : 'It ends ONE command and never its agent: a thread whose command is stopped keeps running. The receipt names three populations, and only confirmed endings are completions.';

const RECOVERY_KEYED = `A reply you never received is NOT a reason to send this again. Read the outcome by the same operation id — read_terminal_operation: it answers pending, admitted, settled, uncertain or expired, and only a proven absence — or a key retention forgot, fourteen days after it was taken — answers unknown. An unavailable store or host is none of those — it is the reading failing, never the act being absent.`;

const RECOVERY_FREE = `This act keeps no operation key and needs none: it changes nothing, so asking again is a second observation rather than a second effect.`;

const SILENCES = `Four answers no reader may fold together. A command this installation never admitted is a REFUSAL and not a row. A row whose host holds nothing under its reference is \`Unheld\` — a generation the host replaced, a record retired out of its inventory — which is a fact about the host and never an ending. A host that could not be read at all is \`Unavailable\`, and it is the one answer a surface must never draw as an idle machine. A reading that reached everything but one region names that region in \`unmeasured\`.
Load is the same discipline. Absent \`usage\` is a host holding no sample; \`usage.cpu\` or \`usage.memory\` tagged \`Unknown\` is a sample from which no figure could be derived, carrying the reason; \`completeness: 'partial'\` is a real reading with a named hole. Every one of them is a silence and none of them is a zero. \`cpu.cores\` is CORE-EQUIVALENTS — 1.0 is one core kept busy, and 8.0 on an eight-core machine is honest — and \`memory\` is a SUM of resident sets counting each process identity once, which is neither unique physical memory nor a whole-tree total under partial coverage.`;

const commandDisplay = (input: { readonly execution?: string; readonly incarnation?: number }, title: string): ToolDisplay =>
  input.execution === undefined || input.incarnation === undefined
    ? { form: 'none' }
    : {
        form: 'none',
        title,
        awaitsMs: 0,
        reference: { kind: 'command', execution: input.execution, incarnation: input.incarnation, standing: false },
      };

export const COMMAND_OPERATIONS = {
  read_commands: operation('read_commands', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: CommandListAnswer.fields }),
    meaning:
      'Read a bounded page of this project’s bounded commands: what was admitted, what it is observed under, and what the host says each one is doing.',
    grammar: `An INDEXED reading of what this installation ADMITTED, never an enumeration of live processes. Work still queued before any child exists, and work that ended without ever acquiring one, are both here; neither is visible to anything that walks a process table. It scans no transcript and probes no process.
The project is the authority and is never a parameter. \`owner\` narrows to one owner by its own key — \`thread:<id>\`, \`operator\`, or \`service:<scope>\` — and \`standing\` answers about the obligation over each row: \`true\` is the work this installation is still answerable for, which is what an idle-looking machine is checked with, and \`false\` is the history beside it, the rows whose obligation has been discharged. The walk is ordered by the admission instant with the execution identity as the tie beneath it, so two commands admitted inside one millisecond have one order; \`order\` reads it from either end — \`oldest\` is the inventory from its beginning, \`newest\` is the same rows from the end the movement is at, which is what a page showing this hour's work must do on a project holding more rows than one page — \`after\` continues it in the direction it was taken, and \`limit\` bounds it.
Live facts come from ONE batched host read over exactly the references this page selected — never a call per row. \`after\` present in the answer means more rows remain; absent is the end of the walk.
Reading starts nothing, ends nothing and grants nothing: no input, no custody, no authority over anybody's work.
${SILENCES}`,
    input: Schema.Struct({
      owner: Schema.optional(
        Schema.NonEmptyString.annotate({
          description:
            'One owner, by its own key: `thread:<id>`, `operator`, or `service:<scope>`. Omitted reads every owner of this project.',
        }),
      ),
      standing: Schema.optional(
        Schema.Boolean.annotate({
          description:
            'Which rows by the obligation over them: `true` is the work this installation is still answerable for, `false` is the history beside it — the rows whose obligation has been discharged, which is where ended work stands. Omitted reads every row, which is what makes an inventory an inventory.',
        }),
      ),
      order: Schema.optional(order),
      after: Schema.optional(cursor),
      limit: Schema.Int.check(Schema.isGreaterThan(0)).annotate({
        description: 'How many rows at most. You state your own bound: this door invents none.',
      }),
    }),
    refusals: ['terminal-selection-changed', 'terminal-no-owner'],
    confirmation: (input: { readonly owner?: string; readonly standing?: boolean; readonly limit: number }) => ({
      summary:
        input.standing === true
          ? `Read up to ${input.limit} of this project’s commands it is still answerable for?`
          : input.standing === false
            ? `Read up to ${input.limit} of this project’s commands it has finished with?`
            : `Read up to ${input.limit} of this project’s bounded commands?`,
      facts: input.owner === undefined ? undefined : [{ label: 'Owner', value: input.owner }],
      consequence: 'Reading starts nothing, ends nothing and grants nothing.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading the commands',
      done: 'Read the commands',
      many: (count) => `Read the commands ${count} times`,
    },
    subjects: () => [],
  }),

  read_command: operation('read_command', {
    approval: ASKS_NEVER,
    ...read,
    doors: OPERATOR_DOORS,
    answer: arms({ ok: CommandReading.fields }),
    meaning:
      'Read one bounded command whole: its admission, its owner, the deadline that holds its life, the mode it is observed under, what its ending measured, and what it is costing now.',
    grammar: `One row of the same reading the page answers, addressed WHOLE — an id without its incarnation addresses nothing, because a replacement host restarts the generation and answering the current row for a reference naming the old one is answering about a different execution.
\`deadline.revision\` is what a change of its life is decided over. Read it here and carry it into that act; a door that read it for you would decide staleness against its own fresh read rather than against what you saw. \`wait.revision\` describes the obligation a proved ending discharges. A \`bash\` call with \`waitMs: 0\` is detached at launch.
\`deadline.expiresAt\` is a wall stamp and DESCRIBES only: the host grades against its own monotonic clock, so it is what a surface draws and never what a caller decides an ending from. A deadline with no \`armed\` has no clock started at all.
Reading starts nothing, ends nothing and grants nothing.
${SILENCES}`,
    input: Schema.Struct({ execution, incarnation }),
    refusals: ['terminal-no-command'],
    confirmation: (input: { readonly execution: string }) => ({
      summary: `Read command ${input.execution} whole: its admission, the deadline that holds its life and what it is costing now?`,
      consequence: 'Reading starts nothing, ends nothing and grants nothing.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a command',
      done: 'Read a command',
      many: (count) => `Read ${count} commands`,
    },
    subjects: () => [],
  }),

  read_command_bytes: operation('read_command_bytes', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: ByteChunk.fields }),
    meaning: 'Read retained stdout, stderr or output bytes of one bounded command by execution and offset.',
    grammar:
      'The execution and incarnation name a command this installation admitted, including one already ended. `output` carries stdout and stderr together, each chunk whole in the order the host read it, under offsets of its own. Offsets are canonical decimal strings; each read returns a base64 byte window, its next offset and whether retention left a gap. Reading moves no cursor. `limit: 0` asks for positions; if the host cannot answer them separately, its byte reader may return one byte to recover the range. A host or retained record that cannot be read refuses or discloses its gap; it never invents an empty successful output.',
    input: Schema.Struct({
      execution,
      incarnation,
      stream: Schema.Literals(['stdout', 'stderr', 'output']),
      offset: ByteOffset.annotate({ description: 'Where to read from, as a canonical decimal string.' }),
      limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      positions: Schema.optional(
        Schema.Boolean.annotate({
          description: 'Answer retained positions beside the bytes. Default true; pass false to skip them.',
        }),
      ),
    }),
    refusals: [
      'terminal-no-command',
      'terminal-stale-authority',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-host-unavailable-absent',
    ],
    confirmation: (input: { readonly execution: string; readonly stream: string; readonly offset: string }) => ({
      summary: `Read ${input.stream} of command ${input.execution} from ${input.offset}?`,
      consequence: 'Reading consumes nothing and moves no other reader’s cursor.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading command bytes',
      done: 'Read command bytes',
      many: (count) => `Read command bytes ${count} times`,
    },
    subjects: () => [],
  }),

  read_output: operation('read_output', {
    approval: ASKS_NEVER,
    ...read,
    tool: { capability: 'shell', direct: true, needs: ['shared'] },
    answer: arms({ ok: CommandOutputReading.fields }),
    meaning: 'Read what a command printed: the output since you last read it, and whether it is still running.',
    grammar: `The one read of a command's output an agent makes. Name the command by the execution and incarnation its launch answered. The first read answers the tail of what stands; every later read answers only what arrived since your previous one, so a running command is read in steps and nothing is read twice. stdout comes first and stderr after it, under the same window a foreground command's answer keeps. A read of an ended command that does not carry all of its output names the file holding its last ${OUTPUT_RETAINED_BYTES / 1024 / 1024} MiB, stdout and stderr in the order printed. It answers at once: the ending of a command you started reaches you as a notice, and one this read already answered whole, with the checkout measured after it, is not sent again.
\`tail\` keeps only the last so many lines of what this read would answer.
${RECOVERY_FREE}`,
    input: Schema.Struct({
      execution,
      incarnation,
      tail: Schema.optional(
        Schema.Int.check(Schema.isGreaterThan(0)).annotate({
          description: 'Answer only the last so many lines.',
        }),
      ),
    }),
    refusals: [
      'terminal-no-command',
      'terminal-stale-authority',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-host-unavailable-absent',
    ],
    confirmation: (input: { readonly execution: string }) => ({
      summary: `Read what command ${input.execution} has printed?`,
      consequence: 'Reading starts nothing, ends nothing and grants nothing.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading command output',
      done: 'Read command output',
      many: (count) => `Read command output ${count} times`,
    },
    called: (input: { readonly execution?: string; readonly incarnation?: number }) => commandDisplay(input, 'Reading command output'),
    subjects: () => [],
    claims: executionReads,
  }),

  search_output: operation('search_output', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: CommandSearchReading.fields }),
    meaning: 'Search what a command printed, ended or still running, for a regex: matching lines with their line numbers and context.',
    grammar: `\`pattern\` is a ripgrep regex matched line by line over the output the host keeps — the last ${OUTPUT_RETAINED_BYTES / 1024 / 1024} MiB of each stream — stdout first, then stderr, unless \`stream\` names one. Line numbers count from the first kept byte of each stream: where earlier output was dropped (\`from\` above 0), its first line may be partial. A line longer than ${OUTPUT_COLUMNS} characters shows the ${OUTPUT_COLUMNS} around its first match, \`…\` marking each cut. A running command is searched as far as it has printed, and the cursor keeps that bound. Searching consumes nothing that read_output answers.
${RECOVERY_FREE}`,
    input: Schema.Struct({
      execution,
      incarnation,
      pattern: Schema.NonEmptyString.annotate({ description: 'A ripgrep regex, matched against each line.' }),
      stream: Schema.optional(
        Schema.Literals(OUTPUT_STREAMS).annotate({ description: 'Search only this stream. Omitted searches stdout, then stderr.' }),
      ),
      ignoreCase: Schema.optional(Schema.Boolean),
      before: Schema.optional(contextLines.annotate({ description: 'Lines of context before each match.' })),
      after: Schema.optional(contextLines.annotate({ description: 'Lines of context after each match.' })),
      limit: limitOf(OUTPUT_MATCHES),
      cursor: PAGE_CURSOR,
    }),
    refusals: [
      'terminal-no-command',
      'terminal-stale-authority',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-record-lost',
      'terminal-host-unavailable-absent',
      'search-failed',
      'search-unavailable',
      'bad-cursor',
      'cursor-stale',
    ],
    confirmation: (input: { readonly execution: string; readonly pattern: string }) => ({
      summary: `Search the output of command ${input.execution} for ${input.pattern}?`,
      consequence: 'Reading consumes nothing and moves no other reader’s cursor.',
    }),
    confirmLabel: 'Search',
    presentation: {
      running: 'Searching command output',
      done: 'Searched command output',
      many: (count) => `Searched command output ${count} times`,
    },
    subjects: () => [],
  }),

  change_command_limit: operation('change_command_limit', {
    approval: { ...ASKS_IN_REVIEW, when: [COMMAND_CEILING] },
    claims: executionWrites,
    ...requestWrite,
    subject: 'head',
    answer: arms({ ok: CommandLimitChanged.fields }),
    meaning: 'Move the life of one bounded command — how long it may run before it is killed — over the life revision you read it at.',
    grammar: `THE REVISION IS THE WHOLE OF THE CONCURRENCY. \`expected\` is the \`deadline.revision\` you read; a change decided over an older one answers \`Stale\` with the deadline that stands NOW, so you decide again instead of overwriting a move you never saw. The operation id names this act in the host's own record; what makes a replay safe is the revision, because a change sent twice over a revision that already moved is answered \`Stale\` rather than applied again.
FOUR OUTCOMES, and none of them is the others. \`Revised\` moved it and carries the deadline that now stands. \`Stale\` changed nothing and carries what stands. \`Refused\` names a fact about the work or the policy: \`not-armed\` is a remaining-duration ask against work whose clock has not started — name a total instead — \`above-ceiling\` passes the bound that stands, \`not-a-command\` is an execution that is not a command, such as a terminal, \`conflict\` is a key already spent on a different change, \`identity\` is a reference naming another installation or a replaced generation. \`Ended\` is work that is already over, carrying the ending that actually happened and inventing no decision for work that never acquired a child.
\`Total\` names the whole allowance and reaches work that is still queued; \`Remaining\` names what is left from now and is converted once against the host's own monotonic clock, which exists only once the deadline is armed.
WHO MAY MOVE IT. Any command of this project moves shorter or longer, up to the ceiling set when the command started: its life rule's, or ${COMMAND_LIFE.ceilingMs} ms where no rule covered it. A total past the ceiling, or \`exceptionMs\`, moves the ceiling itself — an EXCEPTION naming the execution, the new ceiling and the reason; an agent's exception asks the operator first, and the actor comes from authentication and never from an argument.`,
    input: Schema.Struct({
      operationId,
      execution,
      incarnation,
      expected: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        description:
          'The `deadline.revision` you read. A change decided over a revision that moved answers Stale rather than landing over it.',
      }),
      change: Schema.Union([
        Schema.Struct({ _tag: Schema.Literal('Total'), executionMs: Schema.Int.check(Schema.isGreaterThan(0)) }),
        Schema.Struct({ _tag: Schema.Literal('Remaining'), remainingMs: Schema.Int.check(Schema.isGreaterThan(0)) }),
      ]).pipe(Schema.toTaggedUnion('_tag')),
      cause: Schema.NonEmptyString.annotate({
        description: 'Why its life moves. It is recorded beside what the host accepted, as declared.',
      }),
      exceptionMs: Schema.optional(
        Schema.Int.check(Schema.isGreaterThan(0)).annotate({
          description:
            'Replace the CEILING itself; an agent asks the operator first. Omitted, a total past the ceiling raises it to that total, and anything within it moves the life alone.',
        }),
      ),
    }),
    refusals: [
      'terminal-no-command',
      'terminal-ceiling',
      'terminal-stale-authority',
      'terminal-ineligible',
      'terminal-host-unavailable-absent',
    ],
    confirmation: (input: {
      readonly execution: string;
      readonly expected: number;
      readonly change:
        | { readonly _tag: 'Total'; readonly executionMs: number }
        | { readonly _tag: 'Remaining'; readonly remainingMs: number };
      readonly cause: string;
      readonly exceptionMs?: number;
    }) => ({
      summary:
        input.change._tag === 'Total'
          ? `Move the whole allowance of command ${input.execution} to ${input.change.executionMs}ms?`
          : `Leave command ${input.execution} ${input.change.remainingMs}ms from now?`,
      facts: [
        { label: 'Cause recorded', value: input.cause },
        { label: 'Deadline revision read', value: String(input.expected) },
        ...(input.exceptionMs === undefined ? [] : [{ label: 'New ceiling', value: `${input.exceptionMs}ms` }]),
      ],
      consequence:
        input.exceptionMs === undefined
          ? 'A change decided over a revision that moved answers Stale and lands nothing.'
          : 'It replaces the CEILING itself.',
    }),
    confirmLabel: 'Change',
    presentation: {
      running: 'Changing the life of a command',
      done: 'Changed the life of a command',
    },
    subjects: () => [],
    raises: (_input: unknown, terms?: { readonly consents: readonly Raised[] }) => terms?.consents ?? [],
  }),

  stop_command: operation('stop_command', {
    approval: ASKS_IN_REVIEW,
    claims: executionWrites,
    ...requestWrite,
    subject: 'head',
    answer: arms({ ok: ExecutionStopped.fields }),
    meaning: 'End one bounded command and report what the stop actually covered.',
    grammar: `IT ENDS ONE COMMAND, never its agent and never its owner's other work. A thread whose command is stopped keeps running.
The answer is three POPULATIONS, not one verdict: endings confirmed, resources known to survive, and resources that could not be measured at all. Neither of the last two is a completion, and no timer turns one into it.
The cause is yours to declare and is recorded as declared: a timeout is a timeout, never somebody's explicit act. \`signal\` ends it down the host's one ladder — interrupt to a command on pipes, hang-up to a terminal, terminate at 1.5 s if it still stands, kill at 2 s — and the receipt names the step each process ended at; \`destroy\` goes down the same ladder and may abandon output the kernel has not yet handed over, which is why it is a separate choice.
Any command of this project may be stopped.
${RECOVERY_KEYED}`,
    input: Schema.Struct({
      operationId,
      execution,
      incarnation,
      cause: DeclaredCancellationCause,
      action: Schema.optional(Schema.Literals(['signal', 'destroy'])),
    }),
    refusals: [
      'terminal-no-command',
      'terminal-stale-authority',
      'terminal-operator-only',
      'terminal-operation-conflict',
      'terminal-operation-expired',
      'terminal-ineligible',
      'terminal-host-unavailable-absent',
    ],
    confirmation: (input: { readonly execution: string; readonly cause: string; readonly action?: 'signal' | 'destroy' }) => ({
      summary: `Stop command ${input.execution}?`,
      facts: [
        { label: 'Cause recorded', value: input.cause },
        { label: 'How', value: input.action ?? 'signal' },
      ],
      consequence: stopCommandConsequence(input),
    }),
    confirmLabel: 'Stop',
    intent: 'destructive',
    destructiveConsequence: stopCommandConsequence,
    presentation: {
      running: 'Stopping a command',
      done: 'Stopped a command',
    },
    subjects: () => [],
  }),
};

export type CommandOperationId = keyof typeof COMMAND_OPERATIONS;

export const COMMAND_OPERATION_IDS = Object.keys(COMMAND_OPERATIONS) as readonly CommandOperationId[];
