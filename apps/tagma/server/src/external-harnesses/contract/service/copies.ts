import { Context, type Effect } from 'effect';
import type { AgentAside } from '@runlith/agent/AgentAside';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { ThreadContextReading } from '@runlith/agent/thread/rows';
import type { AsideLife } from '@runlith/tagma/adapter/harness';

export type SessionAside = {
  readonly served: ThreadModelSelection;
  readonly life: AsideLife;
  readonly ask: AgentAside['ask'];
};

export type SessionCapture = {
  readonly threadId: string;
  readonly turn: string;
  readonly aside: SessionAside;
  readonly readerInput: string | null;
  readonly reading: ThreadContextReading | null;
};

export class SessionCopies extends Context.Service<
  SessionCopies,
  {
    measured(input: SessionCapture): Effect.Effect<boolean>;
    settled(input: SessionCapture): Effect.Effect<void>;
    exited(threadId: string): Effect.Effect<void>;
  }
>()('tagma/external-harnesses/SessionCopies') {}
