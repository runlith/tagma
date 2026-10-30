import { Effect, Schema } from 'effect';
import type { ThreadBirth, ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import type { Transports } from '@runlith/agent/thread/transport/Transports';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { BirthRefused } from '@runlith/agent/collaboration/threads';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { stored } from '../../platform/store/crossing.js';
import { HarnessAccounts } from '../../providers/contract/service/harness.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { BirthPlace } from '../contract/wire/birth.js';
import { failedAs } from '../contract/service/failure.js';
import { BornFacets, HarnessSandboxes } from '../contract/service/engine.js';
import { HarnessFaceMissing, HarnessRegistry, harnessNotInstalled, SessionRead, type HarnessSeated } from '../contract/service/harness.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import type { HarnessSeat } from '../contract/wire/harness/seat.js';
import { HARNESS_AGENT_ID } from '../contract/wire/harness/names.js';
import { madeIn, Placing } from '../birth/placement.js';
import { NoteWriting } from '../journal/worktreeNotes.js';
import { OperatorNotes } from '../contract/service/notes.js';
import { holdThreadResources } from '../resources/hold.js';
import { ThreadResources } from '../store/resources.js';
import { birthRefusal } from './collaboration.js';

const refused = (childId: string, reason: BirthRefused['reason'], detail: string) =>
  new ThreadCallBroke({ cause: new BirthRefused({ childId, reason, detail }) });

export const makeEngineBirths = Effect.fnUntraced(function* ({
  transports,
  models,
}: {
  readonly transports: () => Transports['Service'];
  readonly models: () => ModelCatalog;
}) {
  const sessionOf = yield* SessionRead;
  const accounts = yield* HarnessAccounts;
  const registry = yield* HarnessRegistry;
  const facets = yield* BornFacets;
  const resources = yield* ThreadResources;
  const placement = yield* Placing;
  const sandboxes = yield* HarnessSandboxes;
  const rollouts = yield* ThreadRollouts;
  const notes = yield* NoteWriting;
  const operatorNotes = yield* OperatorNotes;
  const lifetime = yield* Effect.scope;
  const made = new Map<string, RootId>();

  const branched = new Set<string>();

  const record = Effect.fn('EngineBirths.record')(function* (
    { child, parent, creator, carried, cut, title, host, place }: ThreadBirth,
    tx: WriteUnit<'machine'>,
  ) {
    const hosted = child.agentId === HARNESS_AGENT_ID;
    const served = hosted ? null : yield* servedSeat(child, host);
    const forked = cut === undefined || (!hosted && served === null) ? undefined : yield* forkSeat(parent, child, cut, tx, served);
    const placed =
      place === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(BirthPlace)(place).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    const home = placed?.projectId;
    const birthplace = creator ?? parent;
    const projectId = yield* facets
      .inherit(
        {
          threadId: child.id,
          fromThreadId: birthplace.id,
          contextFrom: parent.id,
          agentId: child.agentId,
          harness: forked ?? served?.seat,
          carried,
          isRoot: child.parentThreadId === null && carried !== 'fresh',
          title,
          projectId: home,
        },
        tx,
      )
      .pipe(stored('inheritFacet'));
    if (served !== null && projectId === undefined) {
      return yield* refused(child.id, 'thread-project-missing', `${served.name} hosts an agent in a project, and the parent works none.`);
    }
    if (projectId !== undefined) {
      yield* holdThreadResources(resources.storage, { threadId: child.id, projectId }, tx);
      yield* placement
        .born(tx, {
          threadId: child.id,
          parentThreadId: birthplace.id,
          lineage: child.parentThreadId === birthplace.id ? 'child' : 'branch',
          guest: host !== undefined || child.hostKind !== null,
          place: placed,
        })
        .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    }
    if (cut !== undefined) {
      yield* operatorNotes.forked(parent.id, child.id, tx).pipe(stored('forkOperatorNotes'));
      if (!hosted && served === null) yield* tx.afterCommit(Effect.sync(() => void branched.add(child.id)));
    }
    if (host !== undefined) yield* sandboxes.admit({ host, child, projectId, carried }, tx);
    const rootMade = projectId === undefined ? null : madeIn(place);
    if (rootMade !== null) made.set(child.id, rootMade);
  });

  const ready = (thread: ThreadRow) =>
    rollout(thread.id).pipe(
      Effect.tap(() => sandboxes.ready(thread)),
      Effect.tap(() =>
        Effect.suspend(() => {
          const madeFor = made.get(thread.id);
          made.delete(thread.id);
          return madeFor === undefined ? Effect.void : notes.created(thread.id, madeFor);
        }),
      ),
      //! Started at once, the export takes its place in the thread's journal lane before the answer, so later entries queue behind it.
      Effect.flatMap((behind) =>
        behind === null
          ? Effect.void
          : Effect.asVoid(
              Effect.forkIn(
                behind.pipe(Effect.tapCause((cause) => Effect.logError(`the rollout of branch ${thread.id} was not exported`, cause))),
                lifetime,
                { startImmediately: true },
              ),
            ),
      ),
    );

  const rollout = (threadId: string) => {
    return Effect.suspend(() =>
      branched.delete(threadId)
        ? failedAs('ensureRollout', rollouts.behind(threadId))
        : Effect.as(failedAs('ensureRollout', rollouts.ensure(threadId)), null),
    );
  };

  const servedSeat = Effect.fnUntraced(function* (
    child: ThreadRow,
    host: ThreadBirth['host'],
  ): Effect.fn.Return<HarnessSeated | null, ThreadCallBroke> {
    const to = {
      provider: child.provider,
      model: child.model,
      reasoning: child.reasoning,
      account: child.account,
      switches: child.switches,
    };
    const seated = Effect.gen(function* () {
      const seating = yield* registry.seating(to, models());
      if (seating === null) return null;
      if (host !== undefined || child.hostKind !== null) {
        return yield* refused(child.id, 'harness-host', `${seating.name} hosts an agent in the local project workspace, not on a host.`);
      }
      return { name: seating.name, seat: yield* seating.seat(child.agentId) };
    });
    return yield* seated.pipe(
      Effect.mapError((cause) =>
        cause instanceof ThreadCallBroke
          ? cause
          : new ThreadCallBroke({ cause: cause instanceof GateRefusal ? birthRefusal(child.id, cause) : cause }),
      ),
    );
  });

  const forkSeat = (
    parent: ThreadRow,
    child: ThreadRow,
    cut: NonNullable<ThreadBirth['cut']>,
    tx: WriteUnit<'machine'>,
    served: HarnessSeated | null,
  ) => {
    const parentId = parent.id;
    const childId = child.id;
    return Effect.gen(function* () {
      const source = yield* sessionOf(parentId, tx).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
      if (source === null || (served !== null && parent.transport.adapter === 'terminal')) return undefined;
      const held = source.session?.account;
      const named =
        held !== undefined &&
        (yield* accounts.launchable(held.provider, held.key).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))));
      const launched = named ? held.key : parent.account;
      const asked = served?.seat.kernel.account ?? null;
      if (served !== null && (served.name !== source.name || (held !== undefined && !named) || (asked !== null && asked !== launched)))
        return undefined;
      const face = yield* registry
        .resolve(source.name as HarnessId)
        .pipe(
          Effect.mapError(
            (missing) =>
              new ThreadCallBroke({ cause: birthRefusal(childId, harnessNotInstalled(missing.harness, source.presentation.install)) }),
          ),
        );
      const history = (yield* transports()
        .of(parent.transport)
        .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })))).history;
      if (history === undefined || face.seat === undefined)
        return yield* new ThreadCallBroke({ cause: new HarnessFaceMissing({ harness: source.name, face: 'fork' }) });
      const refused = (cause: unknown) =>
        cause instanceof GateRefusal
          ? new BirthRefused({ childId, reason: 'harness-contract', detail: `${cause.reason} ${cause.unblock.join('; ')}` })
          : cause;
      yield* history
        .fork(parentId, childId, cut, launched, tx as unknown as ThreadWriteTx)
        .pipe(
          Effect.mapError((failure) =>
            failure instanceof ThreadCallBroke ? new ThreadCallBroke({ cause: refused(failure.cause) }) : failure,
          ),
        );
      if (served !== null) return { ...served.seat, kernel: { ...served.seat.kernel, account: launched } };
      const session: HarnessSeat = yield* face
        .seat(parentId, tx)
        .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause: refused(cause) })));
      return session.kernel === null ? session : { ...session, kernel: { ...session.kernel, switches: child.switches, account: launched } };
    });
  };
  return { record, ready };
});
