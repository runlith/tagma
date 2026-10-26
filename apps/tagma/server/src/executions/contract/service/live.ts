import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { EXECUTION_FEEDS } from '../wire/feeds.js';
import type { CommandAccess, TerminalAccess } from './access.js';
import type { TerminalAdopters } from './adopters.js';
import type { CommandReader } from './commands.js';
import type { LoadFeed } from './load.js';
import type { ExecutionRecords, TerminalScreens } from './records.js';
import type { Terminals } from './terminals.js';
import type { TerminalGrids, ViewLanes, ViewLeases } from './views.js';
import type { TerminalWriting } from './writing.js';

export type ExecutionFeeds = typeof EXECUTION_FEEDS;

export type ExecutionLiveDoor =
  | Terminals
  | TerminalWriting
  | TerminalScreens
  | ExecutionRecords
  | TerminalAccess
  | ViewLeases
  | ViewLanes
  | TerminalGrids
  | CommandReader
  | CommandAccess
  | TerminalAdopters
  | LoadFeed;

export type ExecutionLive = LiveDeclaration<ExecutionFeeds, ExecutionLiveDoor>;
