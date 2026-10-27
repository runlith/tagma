import { Schema } from 'effect';
import { PAGE_CURSOR, pageRows } from '@runlith/paging';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import type { Actor } from '../../../../platform/contract/wire/actor.js';
import { ceilingOf, limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { executionReads, executionShapes, executionWrites } from './shape.js';
import {
  ExecutionStopped,
  TerminalBytesReading,
  TerminalInputOutcome,
  TerminalInventory,
  TerminalOperationReading,
  TerminalPorts,
  TerminalProcesses,
  TerminalReading,
  TerminalScreenReading,
  TerminalSignalled,
  TerminalTransferred,
  TerminalWaited,
} from '../operationAnswers.js';
import { DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { commandLine } from '../terminals.js';
import { family } from '@runlith/paging';
import { NOT_HOLDER } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import type { Raised } from '@runlith/agent/permissions';
import { placeRole } from '../../../../platform/contract/wire/place.js';

const { performed, read, requestWrite, write } = executionShapes({ capability: 'terminals', needs: ['shared'] });

export const TERMINALS = family('terminals', 1, 'text', { text: 351, json: 1429 }, 100, () => ({
  execution: 'exec-1',
  holder: 'thread:01a0cab9',
  commandLine: 'x'.repeat(200),
  cwd: `/${'x'.repeat(22)}`,
}));

const operationId = Schema.NonEmptyString.annotate({
  description:
    'Your own name for this mutation, chosen BEFORE the call and kept. The same name answers the same act; it never runs a second one.',
});

const execution = Schema.NonEmptyString.annotate({ description: 'The execution id.' });
const incarnation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description:
    'The host generation this execution belongs to. A replacement host restarts at a new one, so a reference carrying an old one addresses nothing and is answered as such.',
});

const RECOVERY = `A reply you never received is NOT a reason to send this again. Read the outcome by the same operation id: it answers pending, admitted, settled, uncertain or expired, and only a proven absence — or a key retention forgot, fourteen days after it was taken — answers unknown. An unavailable store or host is none of those — it is the reading failing, never the act being absent.`;

const signalTerminalConsequence = (): string =>
  'Delivery is what the kernel took — never a claim about what the child did with it, and never a stop. This act keeps no operation key: a reply you never receive leaves a delivery nobody can establish, and sending it again is a second signal rather than a retry.';

const stopTerminalConsequence = (input: { readonly action?: 'signal' | 'destroy' }): string =>
  input.action === 'destroy'
    ? 'Destroying may abandon output the kernel has not yet handed over. The receipt names three populations — confirmed endings, resources known to survive, and what could not be measured — and neither of the last two is a completion.'
    : 'The receipt names three populations — confirmed endings, resources known to survive, and what could not be measured. Neither of the last two is a completion, and no timer turns one into it.';

const INPUT = {
  operationId,
  execution,
  incarnation,
  profile: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
};

const TYPED_BY =
  '`typedBy`, present only when somebody other than you typed into this execution, names each such writer — `operator`, `thread:<id>` or `foreign:<harness>:<key>` — with the time of its newest admitted act, newest first. Your own writes are never listed. Read it before acting on the screen: the state you see may be one you did not make.';

const CUSTODY = `Custody is who HOLDS the execution. Typing needs no custody move: every writer types through a lane of its own, and a thread types only into what it holds. Every act names the custody revision it was decided over, so an act on a revision that moved refuses instead of landing somewhere else.`;

type PreparedSubjects = { readonly subjects: readonly PermissionSubject[]; readonly raised?: readonly Raised[] };

const preparedRaised = (_input: unknown, prepared: PreparedSubjects | undefined): readonly Raised[] => prepared?.raised ?? [];

const preparedSubjects = (_input: unknown, prepared: PreparedSubjects): readonly PermissionSubject[] => prepared.subjects;

const actorProject = (actor: Actor): number | null => (actor.kind === 'operator' || actor.kind === 'external' ? null : actor.projectId);

const observationSubjects = (
  input: { readonly execution: string; readonly incarnation: number },
  _prepared: undefined,
  actor: Actor,
): readonly PermissionSubject[] => {
  const projectId = actorProject(actor);
  return projectId === null ? [] : [{ kind: 'read', value: `terminal:${projectId}:${input.execution}/${input.incarnation}` }];
};

const operationReadSubjects = (
  input: { readonly operationId: string },
  _prepared: undefined,
  actor: Actor,
): readonly PermissionSubject[] => {
  const projectId = actorProject(actor);
  return projectId === null ? [] : [{ kind: 'read', value: `terminal:operation:${projectId}:${input.operationId}` }];
};

export const TERMINAL_OPERATIONS = {
  start_terminal: operation('start_terminal', {
    approval: ASKS_IN_REVIEW,
    ...requestWrite,
    doors: performed,
    answer: arms({ ok: TerminalOperationReading.fields }),
    meaning: 'Start a managed execution — a held terminal or a call-bound command — in a resolved working directory of this project.',
    grammar: `The environment, the working directory and the managed roots it stands on are resolved by this server from its own registry; you name a directory, never a receipt or an execution identity you could not have.
A \`pty\` execution starts with the geometry you name, or the host's current born geometry when omitted. An omitted \`program\` starts this server's login shell (\`SHELL\`, or \`/bin/sh\`) with \`-l\`; an explicit program keeps the args you gave. A \`pipes\` execution takes no geometry and is given a written stdin; the two are different executions, not one with a flag.
A \`held\` lifetime outlives the call, the turn and the view that asked for it, and a restart that keeps the execution host; a replacement of that host ends it, and the thread holding it is told. It requires the environment to actually serve one; a guest that cannot refuses rather than being run on this machine instead. A \`call\` lifetime ends with its caller.
Name the work with \`label\` and set variables with \`env\`: the label is what every surface shows the operator, and \`env\` is where a variable belongs — a wrapper program that only shapes the environment becomes the whole identity of the row.
Custody lands on YOU. Starting something directly into another holder's hands is a transfer, and it is a separate act.
${RECOVERY}`,
    input: Schema.Struct({
      operationId,
      cwd: Schema.NonEmptyString.annotate({
        ...placeRole('value'),
        description:
          'Absolute working directory. It is resolved against this installation\u2019s registry, and an external directory is legal only because the lookup was complete.',
      }),
      program: Schema.optional(Schema.NonEmptyString),
      args: Schema.optional(Schema.Array(Schema.String)),
      label: Schema.optional(
        Schema.NonEmptyString.annotate({
          description:
            'Your own words for what this terminal IS — "Tagma app dev server". Every surface shows it before the command line. Omitted, the command line speaks alone.',
        }),
      ),
      env: Schema.optional(
        Schema.Record(Schema.String, Schema.NullOr(Schema.String)).annotate({
          description:
            'Variables for the child, applied over the resolved environment: a string sets, `null` unsets. The values are used and never published — no listing, no row and no answer carries them.',
        }),
      ),
      transport: Schema.Literals(['pipes', 'pty']),
      lifetime: Schema.Literals(['call', 'held']),
      stdin: Schema.optional(
        Schema.Literals(['pipe', 'inherit', 'ignore']).annotate({
          description: 'Which stdin a pipes child is given. `pipe` means you will write to it; absent runs bare.',
        }),
      ),
      geometry: Schema.optional(
        Schema.Struct({
          rows: Schema.Int.check(Schema.isGreaterThan(0)),
          columns: Schema.Int.check(Schema.isGreaterThan(0)),
        }),
      ),
    }),
    refusals: [
      'terminal-ineligible',
      'terminal-foreign-project',
      'terminal-operation-conflict',
      'terminal-operation-expired',
      'terminal-operation-capacity',
      'terminal-capacity',
      'terminal-memory',
      'terminal-stale',
      'terminal-start-no-lane',
    ],
    confirmation: (input: {
      readonly operationId: string;
      readonly cwd: string;
      readonly program?: string;
      readonly args?: readonly string[];
      readonly lifetime: 'call' | 'held';
      readonly transport: 'pipes' | 'pty';
    }) => ({
      summary: `Start ${input.program === undefined ? 'the server login shell (-l)' : commandLine(input.program, input.args ?? [])} in ${input.cwd} as a ${input.lifetime} ${input.transport} execution?`,
      facts: [
        { label: 'Operation', value: input.operationId },
        {
          label: 'Command',
          value: input.program === undefined ? 'the server login shell (-l)' : commandLine(input.program, input.args ?? []),
        },
      ],
      consequence:
        input.lifetime === 'held'
          ? 'It outlives this call, this turn and the view that asked for it, and it holds the root and environment it was admitted against until it is stopped. Custody lands on this thread.'
          : 'It ends with this call. Custody lands on this thread.',
    }),
    confirmLabel: 'Start',
    presentation: {
      running: 'Starting a terminal',
      done: 'Started a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),

  read_terminals: operation('read_terminals', {
    approval: ASKS_NEVER,
    ...read,
    doors: performed,
    answer: arms({ ok: TerminalInventory.fields }),
    meaning: 'List the managed executions this installation still holds for this project — or, asked for, the history beside them.',
    grammar: `BOUNDED BY CUSTODY: without \`standing: false\` the answer is the rows this installation still answers for, which is small by construction; \`standing: false\` walks the history newest first. The page is \`limit\` rows, ${pageRows(undefined, TERMINALS, ceilingOf(TERMINALS))} by default and ${ceilingOf(TERMINALS)} at most: it answers that page, the total behind it, and the \`cursor\` that continues the reading. A cursor handed back alone continues its own narrowing; handed to another question it is refused, so ask again with no cursor to open a new walk. \`holder\` narrows either to one principal — \`thread:<id>\` or \`operator\`.
A projection of what the host accepted: whose each execution is, what a reader picks it out by — its label, its command line, its directory — and what this installation reserved for it. It is not a claim that a process is alive — the host is the authority over that. Reading activates no environment and starts no host.
\`rootId\` is the PLACE a row was started in: the narrowest root of this project holding the directory its start resolved — a worktree's root, or main's for a directory outside every worktree. It is fixed at the start, never where a shell has since \`cd\`-ed. A row with none is unplaced: started outside every root of this project, or accepted before places were recorded and not placed by the upgrade, which placed only the rows still standing. \`launchedFor\` names the thread whose harness session this pty was launched for; a shell anyone opened has none, whoever holds it.
\`listeners\` is what each held terminal is DOING: the listening sockets the host evidenced for it, at the newest reading this installation retains. Absent is a reading nobody has taken yet, never a claim that a port is free, and a URL a program printed mints no listener.
\`host\` is where its memory ledger stands: the share of the machine it was granted, the reserves its live executions hold, the history retained under the same grant, and the count its boot reading of the platform allowed. A start is refused for the RESERVE it cannot find, never for history, which is reclaimed instead. \`null\` there is the host not answering, never an empty ledger.
\`operationKeys\` is the server store's separate account: retained keys against its ceiling, split into pending, admitted, uncertain and settled, plus spent keys whose detail was reclaimed.
\`grants\` counts the live grants to type this process holds, by road: \`view\` for an operator view's lane, \`harness\` for the server speaking for a session, \`agent\` for a run typing through the typing operations. A figure that climbs while no view is open is a leak.`,
    input: Schema.Struct({
      standing: Schema.optional(Schema.Boolean).annotate({
        description: 'Omitted or true: the rows this installation still holds custody of. False: the history, newest first.',
      }),
      holder: Schema.optional(Schema.NonEmptyString).annotate({ description: 'One principal\u2019s rows: `thread:<id>` or `operator`.' }),
      execution: Schema.optional(Schema.NonEmptyString).annotate({
        description:
          'One execution by id, in the listing\u2019s own shape. It narrows the same population the other filters do: a discharged row needs `standing: false` here too, and an empty answer means this filter set holds no such row — read_terminal is the read that answers about one execution alone.',
      }),
      limit: limitOf(TERMINALS),
      cursor: PAGE_CURSOR,
    }),
    refusals: ['bad-cursor', 'cursor-stale'],
    confirmation: (input: { readonly standing?: boolean; readonly holder?: string }) => ({
      summary:
        input.standing === false
          ? 'Read the history of this project’s managed executions?'
          : 'Read the managed executions this project still holds?',
      facts: input.holder === undefined ? undefined : [{ label: 'Holder', value: input.holder }],
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading the terminals',
      done: 'Read the terminals',
      many: (count) => `Read the terminals ${count} times`,
    },
    subjects: () => [],
  }),

  read_terminal: operation('read_terminal', {
    approval: ASKS_NEVER,
    claims: executionReads,
    ...read,
    answer: arms({ ok: TerminalReading.fields }),
    meaning:
      'Read one managed execution: its transport, lifetime, holder, custody revision, the grid it stands at, and the lanes typing into it.',
    grammar:
      'Observation, and nothing more. Observing another holder’s work never grants authority over it. `terminal.rootId` is the place it was started in — the narrowest root of this project holding its start directory, absent when it is unplaced — and `terminal.launchedFor` the thread whose harness session it was launched for, absent for a shell. `state` is the host’s live answer beside the stored projection, and `null` is the host not answering: neither a phase, nor an ending, nor a reason to infer one. It is ALWAYS answered and never left out, so silence is a value a reader sees rather than a key it must notice is missing.\n`endedWithHost` is true when the host generation the execution ran in has been replaced: it ended with that host, and `state` is this server’s account of that ending, carrying no exit.\n`grid` is the rows and columns the terminal stands at now, as the host recorded it beside the bytes; `null` for pipes, or where the host is not answering.\n`lanes` names each lane open into the execution by its writer: `view` for an operator view, `harness` for the server speaking for a session, `agent` for one run of a thread typing through the typing operations, `grid` for the server applying the size a view decided.\n' +
      TYPED_BY,
    input: Schema.Struct({ execution, incarnation }),
    refusals: ['terminal-unknown', 'terminal-foreign-project'],
    confirmation: (input: { readonly execution: string }) => ({
      summary: `Read execution ${input.execution}: whose it is, what it is doing, and who types into it?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a terminal',
      done: 'Read a terminal',
      many: (count) => `Read ${count} terminals`,
    },
    subjects: observationSubjects,
  }),

  read_terminal_operation: operation('read_terminal_operation', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: TerminalOperationReading.fields }),
    meaning: 'Read what one operation key was already answered with, without repeating or reauthorizing the mutation.',
    grammar: `${RECOVERY}
This is the whole recovery road: no inventory search, no new approval, no launch. An expired key keeps its detail retired and stays taken until fourteen days after it was first taken; after that retention forgets it, and the same id names a new act.`,
    input: Schema.Struct({ operationId }),
    refusals: ['terminal-foreign-project', 'terminal-ineligible'],
    confirmation: (input: { readonly operationId: string }) => ({
      summary: `Read what operation ${input.operationId} was already answered with?`,
      consequence:
        'It repeats no mutation and reauthorizes nothing; an expired key stays taken until retention forgets it, fourteen days after it was taken.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a terminal operation',
      done: 'Read a terminal operation',
      many: (count) => `Read ${count} terminal operations`,
    },
    subjects: operationReadSubjects,
  }),

  read_terminal_screen: operation('read_terminal_screen', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: TerminalScreenReading.fields }),
    meaning:
      'Read the interpreted screen of a pty execution as the text it shows: one line per row, as a person at that terminal would read it.',
    grammar:
      'Each row arrives as text with its trailing padding cut (a row the next one continues keeps its spaces: they are text), carrying the line number it stands at and whether it continues the row above; `geometry.viewportLine` says where the visible display begins, so the rows below it are the scrollback the frame still holds. The frame names its own revision and the byte it was parsed through. It is interpreted, never raw application bytes and never stripped history.\n`cells: true` answers the same display in the cell model instead — every cell with its width and its full style — which a viewer reproducing appearance needs and which costs megabytes for one ordinary screen, so ask for it only when the styling is the subject.\nThis is a POINT READ, answered whole: it holds no base of its own, moves no viewer\u2019s, and never answers a patch. A screen followed as it changes is a live subscription, not this.\n' +
      TYPED_BY,
    input: Schema.Struct({
      execution,
      incarnation,
      cells: Schema.optional(Schema.Boolean).annotate({
        description:
          'Answer typed cells with their style instead of text. Megabytes for one screen; for reading what the terminal says, leave it out.',
      }),
    }),
    refusals: ['terminal-unknown', 'terminal-foreign-project'],
    confirmation: (input: { readonly execution: string; readonly cells?: boolean }) => ({
      summary: `Read the screen of execution ${input.execution}${input.cells === true ? ' as typed cells' : ' as text'}?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a terminal screen',
      done: 'Read a terminal screen',
      many: (count) => `Read ${count} terminal screens`,
    },
    subjects: observationSubjects,
  }),

  read_terminal_bytes: operation('read_terminal_bytes', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: TerminalBytesReading.fields }),
    meaning: 'Read a bounded range of one stream of an execution\u2019s byte record.',
    grammar:
      'A pipes execution’s `output` carries stdout and stderr together, each chunk whole in the order the host read it, under offsets of its own. Offsets are canonical decimal STRINGS, because a JS number rounds past 2^53 and a cursor that rounds re-reads or skips bytes with nobody told. Reading consumes nothing: another reader\u2019s position is untouched, and reading twice from one cursor answers the same bytes. The answer says what the record still retains, so a reader learns of a gap instead of reading across one. `limit: 0` reads no bytes at all: it answers the positions alone, which is how a reader learns what the record holds before deciding where to read it.\n' +
      TYPED_BY,
    input: Schema.Struct({
      execution,
      incarnation,
      stream: Schema.Literals(['stdout', 'stderr', 'pty', 'output']),
      offset: ByteOffset.annotate({ description: 'Where to read from, as a canonical decimal string.' }),
      limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      positions: Schema.optional(
        Schema.Boolean.annotate({
          description: 'Answer the record’s retained positions beside the bytes. Default true; pass false to skip them.',
        }),
      ),
    }),
    refusals: ['terminal-unknown', 'terminal-foreign-project'],
    confirmation: (input: { readonly execution: string; readonly stream: string; readonly offset: string }) => ({
      summary: `Read the ${input.stream} record of execution ${input.execution} from ${input.offset}?`,
      consequence: 'Reading consumes nothing: no other reader’s position moves.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading terminal bytes',
      done: 'Read terminal bytes',
      many: (count) => `Read terminal bytes ${count} times`,
    },
    subjects: observationSubjects,
  }),

  write_terminal: operation('write_terminal', {
    approval: { ...ASKS_IN_REVIEW, when: [NOT_HOLDER] },
    claims: executionWrites,
    ...requestWrite,
    doors: performed,
    answer: arms({ ok: TerminalInputOutcome.fields }),
    meaning:
      'Send bytes into an execution this thread holds, through its run’s lane; one another holds moves into this thread’s custody first, on the operator’s word.',
    grammar: `Name this act with an operation id before sending it. The server opens and numbers a lane for this run, checks that the thread still holds the execution on every act, and reads a lost answer back under this id. Admitted bytes are not proof the child consumed them. Approval grants arbitrary input to this interpreter, not approval of any keystroke’s meaning.`,
    input: Schema.Struct({
      ...INPUT,
      bytes: Schema.NonEmptyString.annotate({ description: 'The bytes, base64.' }),
      cause: Schema.optional(Schema.Literals(['typed', 'paste', 'raw'])),
    }),
    refusals: [
      'terminal-unknown',
      'terminal-no-grant',
      'terminal-stale',
      'terminal-not-holder',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-operation-conflict',
      'terminal-operation-expired',
      'terminal-operation-capacity',
      'terminal-capacity',
      'terminal-no-binding',
    ],
    confirmation: (input: { readonly execution: string; readonly operationId: string }) => ({
      summary: `Send input to execution ${input.execution}?`,
      facts: [{ label: 'Operation', value: input.operationId }],
      consequence:
        'The interpreter decides what these bytes mean; approval grants arbitrary input to THIS interpreter and parses no keystroke. Admitted is not consumed, and nothing here can take them back.',
    }),
    confirmLabel: 'Send',
    presentation: {
      running: 'Writing to a terminal',
      done: 'Wrote to a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),

  interrupt_terminal: operation('interrupt_terminal', {
    approval: { ...ASKS_IN_REVIEW, when: [NOT_HOLDER] },
    claims: executionWrites,
    ...requestWrite,
    doors: performed,
    answer: arms({ ok: TerminalInputOutcome.fields }),
    meaning:
      'Send the terminal\u2019s own interrupt to an execution this thread holds; one another holds moves into this thread\u2019s custody first, on the operator\u2019s word.',
    grammar: `Name this act with an operation id; the server numbers it on this run’s lane beside bytes and resizes.
The interrupt is the terminal's OWN: only the host can read the line's VINTR character, so this never guesses a byte for it. It can also be UNSENDABLE, and the answer says which of four: this transport has no line discipline, the child turned ISIG off, the terminal names no interrupt character, or its state could not be read. None of those is answered by killing the process instead: delivering a signal and ending the work are different acts with different consequences, and each has its own.`,
    input: Schema.Struct({ ...INPUT }),
    refusals: [
      'terminal-unknown',
      'terminal-no-grant',
      'terminal-stale',
      'terminal-not-holder',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-operation-conflict',
      'terminal-operation-expired',
      'terminal-operation-capacity',
      'terminal-capacity',
      'terminal-no-binding',
    ],
    confirmation: (input: { readonly execution: string }) => ({
      summary: `Send the terminal’s own interrupt to execution ${input.execution}?`,
      consequence:
        'Only the host can read the line’s interrupt character, so no byte is guessed for it. It can be unsendable, and the answer says which reason; none of them is answered by killing the process instead.',
    }),
    confirmLabel: 'Interrupt',
    presentation: {
      running: 'Interrupting a terminal',
      done: 'Interrupted a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),

  resize_terminal: operation('resize_terminal', {
    approval: { ...ASKS_IN_REVIEW, when: [NOT_HOLDER] },
    claims: executionWrites,
    ...requestWrite,
    doors: performed,
    answer: arms({ ok: TerminalInputOutcome.fields }),
    meaning:
      'Give an execution this thread holds a new geometry; one another holds moves into this thread’s custody first, on the operator’s word.',
    grammar: `Name this act with an operation id; the server numbers it on this run’s lane in order with bytes and interrupts.
A geometry is only meaningful for a \`pty\`; a pipes execution has no size to change.`,
    input: Schema.Struct({
      ...INPUT,
      rows: Schema.Int.check(Schema.isGreaterThan(0)),
      columns: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
    refusals: [
      'terminal-unknown',
      'terminal-no-grant',
      'terminal-stale',
      'terminal-not-holder',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-operation-conflict',
      'terminal-operation-expired',
      'terminal-operation-capacity',
      'terminal-capacity',
      'terminal-no-binding',
    ],
    confirmation: (input: { readonly execution: string; readonly rows: number; readonly columns: number }) => ({
      summary: `Resize execution ${input.execution} to ${input.rows}×${input.columns}?`,
      consequence: 'It enters the same gate as what was typed, in order with it; the application sees the new geometry as one act.',
    }),
    confirmLabel: 'Resize',
    presentation: {
      running: 'Resizing a terminal',
      done: 'Resized a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),

  wait_terminal: operation('wait_terminal', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: TerminalWaited.fields }),
    meaning: 'Watch one execution until it is decided, within an observation budget you declare.',
    grammar: `The budget bounds the WAITING and nothing else. Its expiry answers that the execution is still undecided, which was true the whole time; it never ends held work, and no caller's budget decides a call the host owns.
It is an observation, not a poll: nothing is asked on a timer, and an execution that never decides costs one wait rather than a loop of reads. The operator's words or a report owed to you end the wait early when they arrive, with the execution untouched.
${TYPED_BY}`,
    input: Schema.Struct({
      execution,
      incarnation,
      waitMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: LONGEST_ACT_MS })).annotate({
        description: `How long to watch, at most ${LONGEST_ACT_MS}: this call is held while it watches. It bounds your observation, never the work.`,
      }),
    }),
    refusals: ['terminal-unknown', 'terminal-foreign-project'],
    confirmation: (input: { readonly execution: string; readonly waitMs: number }) => ({
      summary: `Watch execution ${input.execution} for up to ${input.waitMs}ms?`,
      consequence: 'The budget bounds the waiting and nothing else; no held work ends when it expires.',
    }),
    confirmLabel: 'Wait',
    presentation: {
      running: 'Waiting for a terminal',
      done: 'Waited for a terminal',
    },
    called: (input) =>
      typeof input.execution !== 'string' || typeof input.incarnation !== 'number' || !Number.isFinite(input.waitMs)
        ? { form: 'none' }
        : {
            form: 'none',
            title: 'Waiting for a terminal',
            awaitsMs: input.waitMs,
            reference: { kind: 'terminal', execution: input.execution, incarnation: input.incarnation },
          },
    watches: () => true,
    subjects: observationSubjects,
    claims: executionReads,
  }),

  transfer_terminal: operation('transfer_terminal', {
    approval: { ...ASKS_IN_REVIEW, when: [NOT_HOLDER] },
    claims: executionWrites,
    ...requestWrite,
    answer: arms({ ok: TerminalTransferred.fields }),
    meaning: 'Move custody of an execution to another holder; an agent moving one another session holds asks the operator first.',
    grammar: `${CUSTODY}
A transfer preserves the execution's project — a destination outside it refuses outright — and its destination is a live thread of that project or the operator's own custody.
It ends EVERY lane typing into that execution, whoever typed through it: no right to type is inherited across a handover, and each writer opens a lane again if it may still type there. The process and the resources it holds are untouched.
Both sides are fenced while the outcome is unknown, so neither the thread it leaves nor the thread it lands on can be deleted into a question that has no answer yet.
The answer names which of four happened, so a status of ok is never read alone: \`Accepted\` moved the holder and ended every lane with it; \`Standing\` found your key already answered and changed nothing; \`RevisionStale\` means custody moved under the act — read the execution again; \`Uncertain\` means nobody can say whether it took effect — read the operation back by its key, because both sides stay fenced until it is decided. A refusal the host decided before any effect leaves as a refusal, never inside this answer.
${RECOVERY}`,
    input: Schema.Struct({
      operationId,
      execution,
      incarnation,
      expected: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
        description: 'The custody revision you read. An act decided over a revision that moved refuses.',
      }),
      thread: Schema.optional(
        Schema.NonEmptyString.annotate({
          description: 'The thread that takes custody. Omitted hands it to the operator, whose custody names no thread at all.',
        }),
      ),
    }),
    refusals: [
      'terminal-unknown',
      'terminal-destination',
      'terminal-stale',
      'terminal-foreign-project',
      'terminal-operation-conflict',
      'terminal-operation-expired',
      'terminal-operation-capacity',
      'terminal-ineligible',
    ],
    confirmation: (input: { readonly execution: string; readonly expected: number; readonly thread?: string }) => ({
      summary: `Move custody of execution ${input.execution} to ${input.thread ?? 'the operator'}?`,
      facts: [{ label: 'Custody revision read', value: String(input.expected) }],
      consequence:
        'It ends EVERY lane typing into that execution, whoever typed through it: no right to type is inherited across a handover. The process and the resources it holds are untouched, and both threads are fenced while the outcome is unknown.',
    }),
    confirmLabel: 'Transfer',
    presentation: {
      running: 'Transferring a terminal',
      done: 'Transferred a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),

  read_terminal_processes: operation('read_terminal_processes', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: TerminalProcesses.fields }),
    meaning: 'Read the processes the host MEASURED around one execution, as evidence.',
    grammar: `A report carries its own completeness and the regions nobody measured, each with why. \`unavailable\` with an empty list is NOT "nothing is running": it is a reading that did not happen, and it is shown as one.
A row without an association is a process that was measured and NOT tied to this execution; it is never presented as the terminal's. \`unknown\` identity means the relation was measured and the leader's identity was never proven — it is not \`same\`.
This grants nothing. A pid read here is not an argument to any ending act: the authority to end work is the native identity the host retains, never a scanner's finding.`,
    input: Schema.Struct({ execution, incarnation }),
    refusals: ['terminal-unknown', 'terminal-foreign-project'],
    confirmation: (input: { readonly execution: string }) => ({
      summary: `Read the processes the host measured around execution ${input.execution}?`,
      consequence: 'It is evidence and grants nothing: no pid here is an argument to any ending act.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading terminal processes',
      done: 'Read terminal processes',
      many: (count) => `Read terminal processes ${count} times`,
    },
    subjects: observationSubjects,
  }),

  read_terminal_ports: operation('read_terminal_ports', {
    approval: ASKS_NEVER,
    ...read,
    answer: arms({ ok: TerminalPorts.fields }),
    meaning: 'Read the listening sockets the host evidenced for one execution.',
    grammar: `The same completeness rules as the process reading: an unmeasured region is named, and an empty population under \`unavailable\` never means a port is free.
A URL a program printed associates NOTHING. It may decorate a listener the host already evidenced; it can never mint a listener, a port or an owner out of output text, an argument vector or a working directory.
Ports are scoped by environment: the same number in two environments is two listeners, and neither this reading nor any other here reserves, forwards or ends one.`,
    input: Schema.Struct({ execution, incarnation }),
    refusals: ['terminal-unknown', 'terminal-foreign-project'],
    confirmation: (input: { readonly execution: string }) => ({
      summary: `Read the listening sockets the host evidenced for execution ${input.execution}?`,
      consequence: 'It reserves, forwards and ends nothing.',
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading terminal ports',
      done: 'Read terminal ports',
      many: (count) => `Read terminal ports ${count} times`,
    },
    subjects: observationSubjects,
  }),

  signal_terminal: operation('signal_terminal', {
    approval: ASKS_IN_REVIEW,
    claims: executionWrites,
    ...write,
    answer: arms({ ok: TerminalSignalled.fields }),
    meaning: 'Deliver an exact signal to the retained native process of an execution, apart from any stop.',
    grammar: `Delivery is what the KERNEL took — never a claim about what the child did with it, and never a stop. A signal that was not sent names why: the child was reaped, the handle is closed, this build does not send it, a stop already owns the process, or the operating system refused it.
This act keeps NO operation key, because the answer carries none to read back by: a reply you never received leaves a signal whose delivery nobody can establish, and sending it again is a second signal, not a retry.`,
    input: Schema.Struct({ execution, incarnation, signal: Schema.NonEmptyString }),
    refusals: ['terminal-unknown', 'terminal-foreign-project', 'terminal-ineligible'],
    confirmation: (input: { readonly execution: string; readonly signal: string }) => ({
      summary: `Deliver ${input.signal} to the retained native process of execution ${input.execution}?`,
      consequence: signalTerminalConsequence(),
    }),
    confirmLabel: 'Signal',
    intent: 'destructive',
    destructiveConsequence: signalTerminalConsequence,
    presentation: {
      running: 'Signalling a terminal',
      done: 'Signalled a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),

  stop_terminal: operation('stop_terminal', {
    approval: ASKS_IN_REVIEW,
    claims: executionWrites,
    ...requestWrite,
    answer: arms({ ok: ExecutionStopped.fields }),
    meaning: 'End a managed execution and report what the stop actually covered.',
    grammar: `The answer is three POPULATIONS, not one verdict: endings confirmed, resources known to survive, and resources that could not be measured at all. Neither of the last two is a completion, and no timer turns one into it.
The cause is yours to declare and is recorded as it is: a timeout is a timeout, never somebody's explicit act. \`signal\` ends it down the host's one ladder — hang-up to a terminal, interrupt to work on pipes, terminate at 1.5 s if it still stands, kill at 2 s — and the receipt names the step each process ended at; \`destroy\` goes down the same ladder and may abandon output the kernel has not yet handed over, which is why it is a separate choice.
${RECOVERY}`,
    input: Schema.Struct({
      operationId,
      execution,
      incarnation,
      cause: DeclaredCancellationCause,
      action: Schema.optional(Schema.Literals(['signal', 'destroy'])),
    }),
    refusals: [
      'terminal-unknown',
      'terminal-foreign-project',
      'terminal-ineligible',
      'terminal-operation-conflict',
      'terminal-operation-expired',
    ],
    confirmation: (input: { readonly execution: string; readonly cause: string; readonly action?: 'signal' | 'destroy' }) => ({
      summary: `Stop execution ${input.execution}?`,
      facts: [
        { label: 'Cause recorded', value: input.cause },
        { label: 'How', value: input.action ?? 'signal' },
      ],
      consequence: stopTerminalConsequence(input),
    }),
    confirmLabel: 'Stop',
    intent: 'destructive',
    destructiveConsequence: stopTerminalConsequence,
    presentation: {
      running: 'Stopping a terminal',
      done: 'Stopped a terminal',
    },
    subjects: preparedSubjects,
    raises: preparedRaised,
  }),
};

export type TerminalOperationId = keyof typeof TERMINAL_OPERATIONS;

export const TERMINAL_OPERATION_IDS = Object.keys(TERMINAL_OPERATIONS) as readonly TerminalOperationId[];
