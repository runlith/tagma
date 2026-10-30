import { dirname } from 'node:path';
import { Cause, Effect, Exit } from 'effect';
import { harnessRoot } from '../contract/service/table.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessProcessOutcome, HarnessSession } from '../../threads/contract/wire/harness/session.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { SessionObservations } from '../contract/service/observations.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { Environments } from '../../workspace/contract/service/environments.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { Discharge } from '../../executions/contract/service/discharge.js';
import type { PreparedRoot } from '@runlith/tagma/adapter/harness';
import { prepareRoot, verifyPreparedRoot } from './prepareRoot.js';
import type { HarnessPlace } from './launch.js';
import { readWitness, type WitnessTry } from './readWitness.js';
import { provisionReason } from './lifecycle.js';

import type { HeldAnswer } from '../terminal/endings.js';

type SessionAnswered = (threadId: string, answer: HeldAnswer) => Effect.Effect<void, HarnessFailure>;

export type Unprovisioned = { readonly reason: string; readonly cause: Cause.Cause<unknown> };

export class SessionRoots {
  constructor(
    private readonly scratch: ScratchAreas['Service'],
    private readonly store: HarnessSessionStore,
    private readonly access: Environments['Service'],
    private readonly terminals: Terminals['Service'],
    private readonly writing: TerminalWriting['Service'],
    private readonly executionRecords: ExecutionRecords['Service'],
    private readonly discharge: Discharge['Service'],
    private readonly observations: SessionObservations['Service'],
    private readonly finish: (
      threadId: string,
      sessionId: string,
      outcome: HarnessProcessOutcome,
      failure: string | null,
    ) => Effect.Effect<void, HarnessFailure>,
    private readonly answered: SessionAnswered,
    private readonly adapters: HarnessAdapters['Service'],
  ) {}

  provisionPersistedExport(threadId: string, exportPath: string): Effect.Effect<'ready' | Unprovisioned, never> {
    const owned = this.scratch.directory(threadId);
    if (dirname(exportPath) !== owned) {
      return Effect.succeed({
        reason: `export-unavailable: the persisted export path ${exportPath} is not in this thread's scratch directory.`,
        cause: Cause.empty,
      });
    }
    return Effect.exit(this.scratch.ensure(threadId)).pipe(
      Effect.map((provisioned) =>
        Exit.isSuccess(provisioned) ? ('ready' as const) : { reason: provisionReason(owned, provisioned.cause), cause: provisioned.cause },
      ),
    );
  }

  readonly rootFor = Effect.fnUntraced(function* (
    this: SessionRoots,
    threadId: string,
    adapter: HarnessAdapter,
    facet: ExternalSession,
    session: HarnessSession,
    place: HarnessPlace,
    cwd: string,
  ) {
    const { access, finish, terminals, writing, executionRecords, discharge, store } = this;
    const ready = { _tag: 'Ready' as const, minted: undefined as PreparedRoot | undefined };
    const ended = { _tag: 'Ended' as const };
    const prepare = adapter.launch?.prepare;
    if (prepare === undefined) return ready;
    const standing = session.prepared;
    if (standing !== undefined) {
      const read = yield* verifyPreparedRoot(access, adapter, place, standing);
      if (read._tag === 'Bound') return ready;
      if (read._tag === 'Refused') {
        yield* finish(
          threadId,
          session.id,
          'failed',
          `root-unprepared: the prepared root ${standing.id} is not the one its artifact holds — ${read.reason}.`,
        );
        return ended;
      }
      yield* finish(
        threadId,
        session.id,
        'failed',
        `root-unverified: the CLI was not started — the prepared root ${standing.id} could not be re-verified: ${read.reason}.`,
      );
      return ended;
    }
    if (facet.sessionKey !== null) return ready;
    const prepared = yield* prepareRoot(terminals, writing, executionRecords, discharge, access, adapter, prepare, place, {
      sessionId: session.id,
      cwd,
      stopping: store.read(threadId).pipe(
        Effect.map((current) => current?.session?.state === 'stopping' || current?.retiring === true),
        Effect.catch(() => Effect.succeed(false)),
      ),
    });
    if (prepared._tag === 'Prepared') return { _tag: 'Ready' as const, minted: prepared.root as PreparedRoot | undefined };
    if (prepared._tag === 'Aborted') {
      yield* finish(threadId, session.id, 'aborted', null);
      return ended;
    }
    if (prepared._tag === 'Refused') {
      yield* finish(threadId, session.id, 'failed', `root-unprepared: ${prepared.reason}.`);
      return ended;
    }
    yield* finish(
      threadId,
      session.id,
      'failed',
      `root-unprepared: the CLI was not started — the vendor root preparation did not complete: ${prepared.reason}.`,
    );
    return ended;
  });

  exportedRoot(facet: ExternalSession): Effect.Effect<string | null, HarnessFailure> {
    const session = facet.session;
    const exportPath = session?.exportPath;
    const storage = session?.storage;
    const declared = this.adapters.find(facet.name)?.launch?.witness;
    if (session === undefined || exportPath === undefined || storage === undefined || declared === undefined) {
      return Effect.succeed(null);
    }
    return readWitness(this.access, storage.binding, exportPath, declared).pipe(
      Effect.map((read) => (read._tag === 'Found' ? read.id : null)),
    );
  }

  witnessed(facet: ExternalSession): boolean {
    return facet.plain === true || this.adapters.find(facet.name)?.launch?.witness !== undefined;
  }

  witness(threadId: string, facet: ExternalSession): Effect.Effect<WitnessTry, HarnessFailure> {
    const session = facet.session;
    if (session === undefined || session.state !== 'running' || facet.observation.binding.rootKey !== null) {
      return Effect.succeed('moot');
    }
    const adapter = this.adapters.find(facet.name);
    const named =
      facet.plain !== true ? this.exportedRoot(facet) : Effect.succeed(adapter === null ? null : harnessRoot(adapter, session.argv));
    return named.pipe(
      Effect.flatMap((named) =>
        named === null
          ? Effect.succeed('silent' as const)
          : this.observations
              .bindWitness(threadId, session.id, facet.observation.revision, named)
              .pipe(
                Effect.flatMap((receipt) =>
                  receipt.outcome === 'refused'
                    ? Effect.succeed('silent' as const)
                    : Effect.as(this.release(threadId, session.id), 'named' as const),
                ),
              ),
      ),
    );
  }

  readonly release = Effect.fn('HarnessSessions.release')(function* (this: SessionRoots, threadId: string, sessionId: string) {
    const { observations, answered } = this;
    const released = yield* observations.releaseHeld(threadId, sessionId);
    if (released.session === null) return;
    for (const held of released.publish) {
      yield* answered(threadId, { turn: held.turn, text: held.text });
    }
  });

  readonly settleHeld = Effect.fn('HarnessSessions.settleHeld')(function* (this: SessionRoots, threadId: string, sessionId: string) {
    const { observations, answered, store } = this;
    yield* this.release(threadId, sessionId);
    const facet = yield* store.read(threadId);
    if (facet === null) return;
    const proved = facet.observation.binding.rootKey ?? (yield* this.exportedRoot(facet).pipe(Effect.catch(() => Effect.succeed(null))));
    const expired = yield* observations.expireHeld(threadId, sessionId, proved);
    if (expired.session === null) return;
    for (const held of expired.deliver) {
      yield* answered(threadId, {
        turn: held.turn,
        text: held.text,
        unproven: held.rootKey === proved ? undefined : true,
      });
    }
  });
}
