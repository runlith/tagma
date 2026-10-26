import { Schema } from 'effect';
import { InputAnswer } from '@runlith/executions/protocol/input';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { CommandFeedSnapshot, CommandFeedSubscription } from '../commandFeed.js';
import { TERMINAL_REFUSALS } from '../refusals.js';
import { TerminalLaneClosed, TerminalLaneOpened, TerminalTakeOverAnswer, ViewInputCause } from '../viewLeases.js';
import { OPERATOR_DOORS } from './shape.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const viewDoor = {
  doors: OPERATOR_DOORS,
  tool: undefined,
  callers: 'any',
  subject: 'none',
  place: 'machine',
  graph: 'none',
  waits: [],
  lifetimes: [],
  subjects: () => [],
} as const;

const read = { ...viewDoor, effect: 'read', identity: 'none' } as const;
const write = { ...viewDoor, effect: 'write', identity: { key: 'call' } } as const;

const VIEW_REFUSALS = [
  ...TERMINAL_REFUSALS,
  'terminal-unknown',
  'terminal-view-operator',
  'body-shape',
  'unknown-project',
  'project-required',
] as const;

const execution = Schema.String.check(Schema.isMinLength(1));
const incarnation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const LANE_OPERATIONS = {
  read_command_feed: operation('read_command_feed', {
    approval: ASKS_NEVER,
    ...read,
    meaning:
      "Read the project's command feed as one snapshot: the running and the recently ended commands, their terminals and the host that runs them.",
    input: Schema.Struct({ ended: CommandFeedSubscription.fields.ended }),
    answer: arms({ ok: CommandFeedSnapshot.fields }),
    refusals: VIEW_REFUSALS,
    confirmation: () => ({ summary: 'Read the command feed?' }),
    confirmLabel: 'Read feed',
    presentation: { running: 'Reading the command feed', done: 'Read the command feed' },
  }),

  open_terminal_lane: operation('open_terminal_lane', {
    approval: ASKS_IN_REVIEW,
    ...write,
    meaning: 'Open a lane through which one of the operator’s views types into an execution.',
    input: Schema.Struct({
      execution,
      incarnation,
      view: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    }),
    answer: arms({ ok: TerminalLaneOpened.fields }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Open a lane into ${input.execution}?` }),
    confirmLabel: 'Open lane',
    presentation: { running: 'Opening a lane', done: 'Opened a lane' },
  }),

  close_terminal_lane: operation('close_terminal_lane', {
    approval: ASKS_IN_REVIEW,
    ...write,
    meaning: 'Close a lane of one of the operator’s views.',
    input: Schema.Struct({ execution, incarnation, binding: Schema.String.check(Schema.isMinLength(1)) }),
    answer: arms({ ok: TerminalLaneClosed.fields }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Close the lane into ${input.execution}?` }),
    confirmLabel: 'Close lane',
    presentation: { running: 'Closing a lane', done: 'Closed a lane' },
  }),

  take_over_terminal: operation('take_over_terminal', {
    approval: ASKS_IN_REVIEW,
    ...write,
    meaning: "Move custody of an execution to the operator from one of the operator's views.",
    input: Schema.Struct({ execution, incarnation, operationId: Schema.String.check(Schema.isMinLength(1)) }),
    answer: arms({ ok: { answer: TerminalTakeOverAnswer } }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Take over ${input.execution}?` }),
    confirmLabel: 'Take over',
    presentation: { running: 'Taking over a terminal', done: 'Took over a terminal' },
  }),

  input_terminal: operation('input_terminal', {
    approval: ASKS_IN_REVIEW,
    ...write,
    meaning: 'Type into an execution through a live lane of one of the operator’s views, sequenced and paced by the host.',
    input: Schema.Struct({
      execution,
      incarnation,
      binding: Schema.String.check(Schema.isMinLength(1)),
      sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      profile: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      act: Schema.Union([
        Schema.Struct({ _tag: Schema.Literal('Write'), bytes: Schema.String.check(Schema.isMinLength(1)) }),
        Schema.Struct({ _tag: Schema.Literal('Interrupt') }),
        Schema.Struct({
          _tag: Schema.Literal('Resize'),
          rows: Schema.Int.check(Schema.isGreaterThan(0)),
          columns: Schema.Int.check(Schema.isGreaterThan(0)),
        }),
      ]).pipe(Schema.toTaggedUnion('_tag')),
      cause: ViewInputCause,
    }),
    answer: arms({ ok: { answer: InputAnswer } }),
    refusals: VIEW_REFUSALS,
    confirmation: (input) => ({ summary: `Type into ${input.execution}?` }),
    confirmLabel: 'Type',
    presentation: { running: 'Typing into a terminal', done: 'Typed into a terminal' },
  }),
};

export type LaneOperationId = keyof typeof LANE_OPERATIONS;
