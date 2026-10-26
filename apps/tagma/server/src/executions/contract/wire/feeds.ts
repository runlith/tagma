import { feed } from '../../../platform/contract/wire/operation.js';
import { CommandFeedFrame, CommandFeedSubscription } from './commandFeed.js';
import { LoadInterest, LoadInterestTaken, MachineLoadFrame, MachineLoadSubscription } from './load.js';
import { TERMINAL_REFUSALS } from './refusals.js';
import {
  CommandBytesSubscription,
  RecordDelivery,
  RecordParsed,
  TerminalAcknowledged,
  TerminalBytesSubscription,
  TerminalDecider,
  TerminalGridReport,
  TerminalGridSubscription,
  TerminalInputReceipt,
  TerminalInputReceipts,
  TerminalInputWrite,
  TerminalScreenDelivery,
  TerminalScreenPainted,
  TerminalScreenPoint,
  TerminalScreenPointRead,
  TerminalScreenSubscription,
} from './viewLeases.js';

const INPUT_REFUSALS = [...TERMINAL_REFUSALS, 'terminal-input-turn-unavailable'];

export const COMMANDS_FEED = feed('commands.subscribe', {
  input: CommandFeedSubscription,
  event: CommandFeedFrame,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  admission: 'project',
});

export const COMMAND_BYTES_FEED = feed('command.bytes.subscribe', {
  input: CommandBytesSubscription,
  event: RecordDelivery,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  admission: 'project',
});

export const COMMAND_BYTES_PARSED = feed('command.bytes.parsed', {
  input: RecordParsed,
  event: TerminalAcknowledged,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const TERMINAL_SCREEN_FEED = feed('terminal.screen.subscribe', {
  input: TerminalScreenSubscription,
  event: TerminalScreenDelivery,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
});

export const TERMINAL_SCREEN_PAINTED = feed('terminal.screen.painted', {
  input: TerminalScreenPainted,
  event: TerminalAcknowledged,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const TERMINAL_SCREEN_POINT = feed('terminal.screen.point', {
  input: TerminalScreenPointRead,
  event: TerminalScreenPoint,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const TERMINAL_BYTES_FEED = feed('terminal.bytes.subscribe', {
  input: TerminalBytesSubscription,
  event: RecordDelivery,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
});

export const TERMINAL_BYTES_PARSED = feed('terminal.bytes.parsed', {
  input: RecordParsed,
  event: TerminalAcknowledged,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const TERMINAL_INPUT_WRITE = feed('terminal.input.write', {
  input: TerminalInputWrite,
  event: TerminalAcknowledged,
  refusals: INPUT_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const TERMINAL_INPUT_RECEIPTS = feed('terminal.input.receipts', {
  input: TerminalInputReceipts,
  event: TerminalInputReceipt,
  refusals: INPUT_REFUSALS,
  callers: 'operator',
  graph: 'none',
});

export const TERMINAL_GRID_FEED = feed('terminal.grid.subscribe', {
  input: TerminalGridSubscription,
  event: TerminalDecider,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
});

export const TERMINAL_GRID_REPORT = feed('terminal.grid.report', {
  input: TerminalGridReport,
  event: TerminalAcknowledged,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const LOAD_MACHINE_FEED = feed('load.machine', {
  input: MachineLoadSubscription,
  event: MachineLoadFrame,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
});

export const LOAD_INTEREST = feed('load.interest', {
  input: LoadInterest,
  event: LoadInterestTaken,
  refusals: TERMINAL_REFUSALS,
  callers: 'operator',
  graph: 'none',
  stream: false,
});

export const EXECUTION_FEEDS = [
  COMMANDS_FEED,
  LOAD_MACHINE_FEED,
  LOAD_INTEREST,
  COMMAND_BYTES_FEED,
  COMMAND_BYTES_PARSED,
  TERMINAL_SCREEN_FEED,
  TERMINAL_SCREEN_PAINTED,
  TERMINAL_SCREEN_POINT,
  TERMINAL_BYTES_FEED,
  TERMINAL_BYTES_PARSED,
  TERMINAL_INPUT_WRITE,
  TERMINAL_INPUT_RECEIPTS,
  TERMINAL_GRID_FEED,
  TERMINAL_GRID_REPORT,
] as const;
