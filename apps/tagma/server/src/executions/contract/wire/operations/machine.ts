import { Schema } from 'effect';
import { MachineMemory } from '@runlith/executions/protocol/evidence';
import { ProcessEnding, ProcessTarget } from '@runlith/executions/protocol/stop';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { LoadRow, LoadTop, LoadTotals, LoadView, MachineState } from '../load.js';
import { family, pageRows } from '@runlith/paging';
import { ceilingOf } from '../../../../platform/contract/wire/pageFamily.js';
import { TERMINAL_REFUSALS } from '../refusals.js';
import { executionShapes, OPERATOR_DOORS } from './shape.js';

export const ROW_PROCESSES = 8;

const processSample = (pid: number) => ({
  pid,
  birth: '1791460000:000000',
  parent: pid - 1,
  execution: '01a13616-e64d-7243-bac2-4d8b0e28c96e:1',
  name: 'Google Chrome Helper (Renderer)',
  command: `/${'worker/'.repeat(12)}program ${'--argument value '.repeat(8)}`,
  share: 0.0125,
  memoryBytes: 104857600,
  killable: true,
});
const rowSample = () => ({
  key: 'agent:01a13616-e64d-7243-bac2-4d8b0e28c96e',
  kind: 'agent',
  title: 'Typecheck tagma and the github kit for the release',
  detail: 'bun run typecheck',
  project: { id: 5, name: 'runlith' },
  thread: '01a13616-e64d-7243-bac2-4d8b0e28c96e',
  share: 0.25,
  rank: 0.24,
  memoryBytes: 2147483648,
  unread: 0,
  minor: false,
  processes: Array.from({ length: ROW_PROCESSES }, (_, at) => processSample(40_000 + at)),
  work: {
    executions: [
      {
        projectId: 5,
        key: 'execution:1',
        kind: 'command',
        transport: 'pipes',
        execution: { installation: 'i', execution: 'e', incarnation: 1 },
        session: false,
        label: 'bun run typecheck',
        share: 0.25,
        memoryBytes: 2147483648,
      },
    ],
    residuals: [],
  },
  more: 12,
});
const rowBytes = new TextEncoder().encode(JSON.stringify(rowSample())).byteLength + 1;
export const MACHINE_ROWS = family('machine-rows', 1, 'json', { json: rowBytes, text: rowBytes }, 12, rowSample);
export const machineLimit = (limit: number | undefined): number => pageRows(limit, MACHINE_ROWS, ceilingOf(MACHINE_ROWS));

export const MachineRow = Schema.Struct({ ...LoadRow.fields, more: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) });
export type MachineRow = typeof MachineRow.Type;

export const MachineReport = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Read'),
    cores: Schema.Int,
    machine: LoadView.fields.machine,
    share: Schema.NullOr(Schema.Number),
    memory: MachineMemory,
    saturated: Schema.Boolean,
    rows: Schema.Array(MachineRow),
    total: Schema.Int,
    totals: LoadTotals,
    top: Schema.optional(LoadTop),
    background: LoadView.fields.background,
    unresolved: LoadView.fields.unresolved,
    unread: Schema.optional(Schema.String),
  }),
  MachineState.cases.Waiting,
  MachineState.cases.Lost,
  MachineState.cases.Outdated,
]).pipe(Schema.toTaggedUnion('_tag'));
export type MachineReport = typeof MachineReport.Type;

export const MACHINE_OPERATIONS = {
  read_machine_load: operation('read_machine_load', {
    approval: ASKS_NEVER,
    ...executionShapes({ capability: 'terminals', needs: ['shared'] }).read,
    meaning: 'Read what takes the machine CPU and memory now: every process charged to one row, an agent with all its work or a program.',
    grammar: `Shares are fractions of the whole machine, and the rows add up to the machine CPU; machine is what the system calls this kind of computer. Tagma's own rows: server (with the work it runs itself and the short-lived children it reaps), host (the terminal host: the execution host and its process holder), interface (the window's main and utility processes and the renderer drawing Tagma), graphics (the window's graphics process), renderer (one window process drawing built-in browser pages or app and MCP views, titled by what it draws; close names the pages it hosts), agent (all the processes of one thread's commands and terminals, short-lived children and what they left running included) and work (a Tagma command or terminal no thread owns). Outside rows: a program row is one application with all its helpers; the kernel row is what the kernel spent outside every listed process. unresolved lists window processes that could not be matched to a process of the machine, whose load stands outside Tagma. Totals sum Tagma's own rows, each of agents and work, everything outside Tagma, and the small outside rows a panel folds; once the machine memory is read, the outside memory is the machine's used memory beyond Tagma's, since process footprints overlap and their sum overstates it. A total's share is null before the first interval, its memory null when no process was read, and unread counts the processes whose CPU it misses; lowerBound on a row means its share misses processes born and gone between readings. Rows come heaviest first by their average over the last seconds, and top names Tagma's heaviest own row once it takes a tenth of the machine; background lists work the server does on its own, with its progress, inside the server row's share; each carries its ${ROW_PROCESSES} heaviest processes and counts the rest in more. A process's share includes the short-lived children it ran and reaped between readings, and reapedShare is that part of it; a process of a live command or terminal names its key in execution, and parent is its parent pid; a process of the server or host row names its role. A pid answers the row holding that process. This read starts sampling only for the reading, includes processes the system hides from this user, and never starts or ends work.`,
    input: Schema.Struct({
      limit: Schema.optional(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: ceilingOf(MACHINE_ROWS) })).annotate({
          description: `How many of the heaviest rows to return; ${machineLimit(undefined)} by default, ${ceilingOf(MACHINE_ROWS)} at most. The answer carries the total row count.`,
        }),
      ),
      pid: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    }),
    answer: arms({ ok: { state: MachineReport, shown: Schema.Int } }),
    refusals: TERMINAL_REFUSALS,
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the machine load and its top processes?' }),
    confirmLabel: 'Read machine load',
    presentation: { running: 'Reading machine load', done: 'Read machine load' },
  }),
  end_machine_process: operation('end_machine_process', {
    approval: ASKS_IN_REVIEW,
    doors: OPERATOR_DOORS,
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    graph: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    meaning: 'End measured processes — one, or every process of a program — rechecking each native start identity before each signal.',
    grammar:
      "Each target carries its machine scope and start witness, as the machine load listed it. Tagma's own server, execution host and window processes, and processes this user may not signal, are refused. A changed identity, unreadable process or refused signal remains an explicit refusal. Ended means the selected identity was observed gone; Survived means it remained after terminate and kill.",
    input: Schema.Struct({ targets: Schema.Array(ProcessTarget).check(Schema.isMinLength(1)) }),
    answer: arms({ ok: { outcomes: Schema.Array(ProcessEnding) } }),
    refusals: TERMINAL_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({
      summary: input.targets.length === 1 ? `End process ${input.targets[0]!.identity.pid}?` : `End ${input.targets.length} processes?`,
      consequence: 'Requests terminate and, if necessary, kill. Unsaved work in them may be lost.',
    }),
    confirmLabel: 'End',
    intent: 'destructive',
    destructiveConsequence: () => 'The selected processes are terminated; their unsaved work may be lost.',
    presentation: { running: 'Ending a machine process', done: 'Answered process ending' },
  }),
};
export type MachineOperationId = keyof typeof MACHINE_OPERATIONS;
