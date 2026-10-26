import { Context, type Effect } from 'effect';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';
import type { Config, ConfigRefusal } from '../wire/config.js';

export type ConfigVersion = {
  readonly projectId: number;
  readonly actor: TerminalActor;
  readonly root: string;
  readonly tree: string;
  readonly commonDir?: string | undefined;
};

export type ConfigHistory = { readonly root: string; readonly commits: readonly string[] };

export class Configs extends Context.Service<
  Configs,
  {
    read(version: ConfigVersion): Effect.Effect<Config | null, GateRefusal<ConfigRefusal> | OwnGitFailed>;
    carried(history: ConfigHistory): Effect.Effect<ReadonlySet<string>, OwnGitFailed>;
  }
>()('tagma/config/Configs') {}
