import { Context, type Effect } from 'effect';

export type ProfileOutcome = 'read' | 'timeout' | 'exit' | 'spawn-failed' | 'empty' | 'no-shell' | 'not-needed';

export type ProfileRead = {
  readonly outcome: ProfileOutcome;
  readonly entries: readonly string[];
  readonly detail: string | null;
};

export type ProfileAsk = {
  readonly shell: string | null;
  readonly launchPath: string;
  readonly home: string;
  readonly deadlineMs: number;
};

export type UserShell = {
  readonly desktopLaunch: (launchPath: string) => boolean;
  readonly managers: (home: string) => readonly string[];
  readonly fallback: (home: string) => readonly string[];
  readonly runtimes: (home: string) => readonly string[];
  readonly read: (ask: ProfileAsk) => Promise<ProfileRead>;
};

export type UserPaths = {
  readonly path: string;
  readonly profile: ProfileRead | null;
  readonly reading: boolean;
};

export const LAUNCH_PATH = 'TAGMA_LAUNCH_PATH';
export const PROFILE_PATHS = 'TAGMA_PROFILE_PATHS';

export class UserEnvironment extends Context.Service<
  UserEnvironment,
  {
    readonly ready: Effect.Effect<UserPaths>;
    readonly now: Effect.Effect<UserPaths>;
    readonly refresh: Effect.Effect<UserPaths>;
    locate(name: string, dirs: readonly string[]): Effect.Effect<readonly string[]>;
    readonly handoff: () => Readonly<Record<string, string>>;
  }
>()('tagma/installation/UserEnvironment') {}
