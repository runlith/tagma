import type { Effect } from 'effect';
import type { Perform } from '../../platform/contract/service/perform.js';
import type { Invocation } from '../../platform/cli/verb.js';
import type { Project } from '../../graph/contract/wire/rows.js';
import type { InstallFailed, McpDeclarationWrite } from '../contract/wire/install.js';
import type { Answered } from '../voice/status.js';
import type { StartupState } from '../contract/wire/restart.js';

export type Lens = { readonly cwd?: string; readonly project?: string };

export type InstallationOperation = 'read_machine_state' | 'install_next' | 'stop_installing' | 'restart_server' | 'check_successor';

export type InstallationDoor = {
  readonly operations: {
    perform(request: {
      readonly params: { readonly id: InstallationOperation };
      readonly query: Lens;
      readonly headers: Record<string, string | number | undefined>;
      readonly payload: unknown;
    }): Effect.Effect<unknown, unknown>;
  };
};

export type ServerCli = {
  readonly perform: Perform;
  readonly ask: <A>(call: (door: InstallationDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly baseUrl: (at: Invocation) => string;
  readonly boundAddress: (at: Invocation) => string;
  readonly boundHere: (at: Invocation, address: string) => boolean;
  readonly health: () => Effect.Effect<Answered>;
  readonly healthOrNone: () => Effect.Effect<Answered | null>;
  readonly startup: () => Effect.Effect<StartupState>;
  readonly here: (at: Invocation) => { readonly cwd: string };
  readonly lens: (at: Invocation, options: { readonly project?: string | undefined }) => Lens;
};

export type Declare = (repoRoot: string) => Promise<McpDeclarationWrite[]>;

export type Refresh<E> = {
  readonly projects: Effect.Effect<readonly Project[], E>;
  readonly law: (projectId: number) => Effect.Effect<string, E>;
  readonly declare: Declare;
};

export type Refreshed = { readonly failed?: string | undefined };

export type InstallationCli<User, Repo, Entry extends Refreshed> = ServerCli & {
  readonly installForUser: () => Effect.Effect<User, InstallFailed>;
  readonly installInto: (repoRoot: string, lawSection: string, declare: Declare) => Effect.Effect<Repo, InstallFailed>;
  readonly refreshInstallations: <E>(deps: Refresh<E>) => Effect.Effect<readonly Entry[], E | InstallFailed>;
  readonly renderInstallResult: (installed: Repo) => string[];
  readonly renderUserInstallResult: (served: User, project: string) => string[];
  readonly renderUpgradeResult: (done: readonly Entry[]) => string[];
};
