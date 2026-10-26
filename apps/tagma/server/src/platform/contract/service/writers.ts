import { Context, type Effect } from 'effect';
import type { SessionRef } from '../wire/session.js';
import type { StoreFailure } from './store.js';
import type { WriteUnit } from './units.js';

export type SessionRow = { readonly id: number; readonly harness: string; readonly key: string; readonly createdAt: Date };

export type WriterRef = { readonly id: number; readonly harness: string; readonly key: string } | null;

export const SignedSession = Context.Reference<SessionRef | null>('tagma/platform/SignedSession', {
  defaultValue: () => null,
});

export const SignedCall = Context.Reference<string | null>('tagma/platform/SignedCall', {
  defaultValue: () => null,
});

export class WriterRegister extends Context.Service<
  WriterRegister,
  {
    resolve(unit: WriteUnit<'graph'>, ref: SessionRef): Effect.Effect<SessionRow, StoreFailure>;
    signedId(unit: WriteUnit<'graph'>): Effect.Effect<number | null, StoreFailure>;
    idOf(ref: SessionRef): Effect.Effect<number | null, StoreFailure>;
    byId(id: number): Effect.Effect<SessionRow | undefined, StoreFailure>;
    writerOf(sessionId: number | null): Effect.Effect<WriterRef, StoreFailure>;
    named(ids: readonly number[]): Effect.Effect<SessionRow[], StoreFailure>;
    all(): Effect.Effect<SessionRow[], StoreFailure>;
  }
>()('tagma/platform/WriterRegister') {}

export class MachineWriters extends Context.Service<MachineWriters, { signedId(): Effect.Effect<number | null, StoreFailure> }>()(
  'tagma/platform/MachineWriters',
) {}
