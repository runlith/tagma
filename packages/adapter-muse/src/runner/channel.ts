import { Context, Data, type Effect, type Scope } from 'effect';
import type { AgentFault } from '@runlith/acp/agent';

export type Frame = {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly request: boolean;
};

type HostLaunch = {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly sessionMcp: boolean;
  readonly frame: (frame: Frame) => Effect.Effect<void>;
  readonly stderr: (text: string) => void;
};

export class MuseRefused extends Data.TaggedError('MuseRefused')<{
  readonly method: string;
  readonly kind: string;
  readonly code: number;
  readonly message: string;
}> {}

export interface Host {
  readonly home: string;
  command(method: string, params: Record<string, unknown>, commandId?: string): Effect.Effect<Record<string, unknown>, MuseRefused>;
  request(method: string, params: Record<string, unknown>): Effect.Effect<Record<string, unknown>, MuseRefused>;
  mint(): string;
  readonly ended: Effect.Effect<string>;
}

export class MuseSdk extends Context.Service<
  MuseSdk,
  {
    readonly open: (launch: HostLaunch) => Effect.Effect<Host, AgentFault, Scope.Scope>;
  }
>()('adapter-muse/MuseSdk') {}
