import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Capture, CapturesEvent } from '../wire/feeds.js';

export type Stop = Effect.Effect<void, GateRefusal | StoreFailure>;

type Target = { readonly kind: string; readonly id: string };

export class Captures extends Context.Service<
  Captures,
  {
    open(capture: Capture, stop: Stop): Effect.Effect<void>;
    end(kind: string, id: string): Effect.Effect<void>;
    count(kind: string): Effect.Effect<number>;
    stop(target: Target | null): Effect.Effect<number, GateRefusal<'unknown-capture' | 'stop-refused'> | StoreFailure>;
    readonly events: Stream.Stream<CapturesEvent>;
  }
>()('tagma/speech/Captures') {}
