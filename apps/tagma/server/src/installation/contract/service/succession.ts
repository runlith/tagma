import { Context, Data, type Effect, type Stream } from 'effect';
import type { Installation, InstallationFailure } from '../wire/manifest.js';
import type { InstallationCut, Restart, RestartHost, Source } from '../wire/source.js';
import type { MigrationLoad } from '../../../platform/contract/wire/migrationLoad.js';

export class SuccessionRefused extends Data.TaggedError('SuccessionRefused')<{ readonly detail: string }> {}

export class HostUnprepared extends Data.TaggedError('HostUnprepared')<{ readonly detail: string }> {}

export class SuccessorFailed extends Data.TaggedError('SuccessorFailed')<{ readonly detail: string; readonly log: string }> {}

export type SuccessorPlan = {
  readonly migrations: number;
  readonly heavy?: MigrationLoad;
  readonly hostState: string;
};

export type SuccessionPreparation = (installation: Installation | null) => Effect.Effect<SuccessorPlan, SuccessionRefused>;

export type SuccessorLaunch = {
  start(command: readonly string[], env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<void>;
  cancel(): void;
  readonly releases: boolean;
  release(failure: string | null): void;
};

export type ProcessBirth = {
  readonly startedAt: string;
  readonly replacedPid: number | null;
};

export class ServerProcess extends Context.Service<
  ServerProcess,
  {
    readonly born: ProcessBirth;
    readonly source: Source;
  }
>()('tagma/installation/ServerProcess') {}

export type HostRefusal = {
  readonly successor: InstallationCut | null;
  readonly detail: string;
};

export class Succession extends Context.Service<
  Succession,
  {
    readonly current: Effect.Effect<Installation | null, InstallationFailure>;
    readonly leaving: Effect.Effect<boolean>;
    restart(host?: RestartHost): Effect.Effect<Restart, SuccessionRefused | SuccessorFailed | HostUnprepared>;
    readonly refused: Effect.Effect<HostRefusal | null>;
    readonly refusals: Stream.Stream<void>;
    readonly release: (failure: string | null) => Effect.Effect<void, SuccessorFailed>;
    readonly settle: Effect.Effect<void>;
  }
>()('tagma/installation/Succession') {}
