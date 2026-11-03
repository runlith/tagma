import { Context, type Effect, type Stream } from 'effect';
import type { Unblock, Words } from '../../../platform/contract/wire/refusal.js';
import type { Installed, Installing, NextFrame, NextIssue, NextIssueCode, Then } from '../wire/next.js';

type Refused<Code extends string> = {
  readonly code: Code;
  readonly reason: string;
  readonly unblock: Unblock;
  readonly words?: Words;
};

export type InstallRefused = Refused<'no-offer' | 'offer-unavailable' | 'install-running' | 'install-restarting' | NextIssueCode>;

export type StopRefused = Refused<'nothing-installing' | 'install-restarting'>;

export type InstallStart = {
  readonly installing: Installing;
  readonly replaced: Installed | null;
};

export class NextInstallation extends Context.Service<
  NextInstallation,
  {
    readonly reading: Effect.Effect<NextFrame>;
    readonly check: Effect.Effect<NextFrame>;
    readonly changes: Stream.Stream<NextFrame, NextIssue>;
    readonly installing: Effect.Effect<Installing | null>;
    install(offer: string, then: Then | null, replacing: string | null): Effect.Effect<InstallStart, InstallRefused>;
    stop(): Effect.Effect<Installed, StopRefused>;
  }
>()('tagma/installation/NextInstallation') {}
