import type { ToolCaller } from '@runlith/agent/contracts';
import type { CommentPolicy } from '@runlith/source-comments';
import type { Effect } from 'effect';
import type { CheckoutFlights } from './CheckoutFlights';
import type { CommandTimes } from './CommandWork';
import type { WebSearchSessions } from './WebSearchSessions';
import type { WorkspaceChanges } from './WorkspaceChanges';
import type { World } from './world';

export type WorkspaceBindings = {
  readonly of: (target: string, real: string | null) => string | null;
};

export type WebSearchOptions = {
  modelName?: string;
  sessions?: WebSearchSessions;
};

export type CheckoutMode = 'shared' | 'single';

export const COMMAND_DESCRIPTIONS = ['required', 'optional'] as const;
export type CommandDescription = (typeof COMMAND_DESCRIPTIONS)[number];
export const DEFAULT_COMMAND_DESCRIPTION: CommandDescription = 'required';

export type ToolEnvCall = {
  readonly toolCallId: string;
  readonly step?: number;
  readonly caller: ToolCaller;
};

export type ToolFactoryOptions = {
  changes?: WorkspaceChanges;
  changesOf?: (caller: ToolCaller) => WorkspaceChanges;
  bindings?: WorkspaceBindings;
  unowned?: readonly string[];
  cwd: string;
  world: World;
  websearch?: WebSearchOptions;
  allowOutsideCwd?: boolean;
  comments?: (target: string) => Effect.Effect<CommentPolicy, Error>;
  checkout?: (at: string) => Effect.Effect<CheckoutMode, Error>;
  checkoutAt?: (tree: string) => Effect.Effect<boolean, Error>;
  flights?: CheckoutFlights;
  env?: Record<string, string | undefined>;
  callEnv?: (call: ToolEnvCall) => Record<string, string | undefined>;
  commandTimes: CommandTimes;
  commandDescription?: CommandDescription;
  searchMs: number;
};

export type ResolvedToolOptions = {
  cwd: string;
  allowOutsideCwd: boolean;
  world: World;
  changes?: WorkspaceChanges;
  bindings?: WorkspaceBindings;
  unowned: readonly string[];
  comments: (target: string) => Effect.Effect<CommentPolicy, Error>;
  checkout: (at: string) => Effect.Effect<CheckoutMode, Error>;
  checkoutAt: (tree: string) => Effect.Effect<boolean, Error>;
  env: Record<string, string | undefined>;
  callEnv: (call: ToolEnvCall) => Record<string, string | undefined>;
  commandTimes: CommandTimes;
  searchMs: number;
  readonly at: (caller: ToolCaller) => ResolvedToolOptions;
};

export type PreparedResource = { readonly path: string; readonly root: string };

export type PreparedPath = {
  readonly target: string;
  readonly resource: PreparedResource | null;
  readonly binding: string | null;
  readonly entry?: true;
};
