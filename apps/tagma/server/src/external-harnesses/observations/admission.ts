import { Clock, Effect } from 'effect';
import type { HarnessAccepted } from '../contract/service/observations.js';
import { rootOf, workBound, sameField, sourceOf, sameBinding, field } from './binding.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { HARNESS_DETAIL_MAX } from '@runlith/tagma/adapter/harness';
import {
  HARNESS_DIAGNOSTIC_LIMIT,
  HARNESS_HELD_LIMIT,
  type HarnessBinding,
  type HarnessDiagnostic,
  type HarnessEvent,
  type HarnessField,
  type HarnessObservation,
  type HarnessReceipt,
  type HarnessStale,
} from '../../threads/contract/wire/harness/observation.js';
import { observationRebound } from './staleness.js';
import { written } from './landing.js';
import type { HarnessHeldAnswer } from '../../threads/contract/wire/harness/answer.js';
import type { HarnessSession } from '../../threads/contract/wire/harness/session.js';

type HeldRelease = { readonly publish: readonly HarnessHeldAnswer[]; readonly session: HarnessSession | null };
type HeldExpiry = { readonly deliver: readonly HarnessHeldAnswer[]; readonly session: HarnessSession | null };
import type { HarnessSessionStore } from '../store/sessions.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { adoptSessionTitle } from '../titles.js';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';

const TITLE_ATTEMPTS = 3;

export class HarnessObservations {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly db: StoreDb<'machine'>,
    private readonly units: MachineUnits['Service'],
    private readonly records: ThreadRecords['Service'],
    private readonly published?: (threadId: string) => Effect.Effect<void, never>,
    private readonly autoAdopt?: (threadId: string) => Effect.Effect<boolean, never>,
  ) {}

  read(threadId: string): Effect.Effect<HarnessObservation | null, HarnessFailure> {
    return Effect.map(this.store.read(threadId), (facet) => facet?.observation ?? null);
  }

  speaking(
    threadId: string,
    source: { readonly sessionId: string | null; readonly rootKey: string | null },
  ): Effect.Effect<
    | { readonly _tag: 'Proven'; readonly session: HarnessSession }
    | { readonly _tag: 'Unjudged'; readonly session: HarnessSession; readonly rootKey: string }
    | { readonly _tag: 'Refused'; readonly cause: HarnessDiagnostic['cause']; readonly detail: string },
    HarnessFailure
  > {
    return Effect.map(this.store.read(threadId), (facet) => {
      const session = facet?.session;
      if (facet === null || session === undefined) {
        return { _tag: 'Refused' as const, cause: 'execution-unproven' as const, detail: 'No external session stands on this thread.' };
      }
      if (source.sessionId === null || source.sessionId !== session.id) {
        return {
          _tag: 'Refused' as const,
          cause: 'stale-execution' as const,
          detail: `This source names no standing execution of ${threadId}.`,
        };
      }
      const bound = facet.observation.binding.rootKey;
      if (source.rootKey === null) {
        return { _tag: 'Refused' as const, cause: 'root-unproven' as const, detail: 'This source proves no root session.' };
      }
      if (bound === null) {
        return { _tag: 'Unjudged' as const, session, rootKey: source.rootKey };
      }
      if (bound !== source.rootKey) {
        return {
          _tag: 'Refused' as const,
          cause: 'foreign-root' as const,
          detail: `This source names a session other than the bound root of ${threadId}.`,
        };
      }
      return { _tag: 'Proven' as const, session };
    });
  }

  notedWords(threadId: string, cause: HarnessDiagnostic['cause'], detail: string): Effect.Effect<void, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => {
      const at = new Date(now).toISOString();
      return this.store
        .change(threadId, (facet) => {
          const standing = facet.observation;
          const said = { cause, at, detail: detail.slice(0, HARNESS_DETAIL_MAX) };
          const last = standing.diagnostics.at(-1);
          if (last !== undefined && last.cause === said.cause && last.detail === said.detail) {
            return Effect.succeed({ facet, value: undefined });
          }
          return Effect.succeed({
            facet: {
              ...facet,
              observation: {
                ...standing,
                revision: standing.revision + 1,
                diagnostics: [...standing.diagnostics, said].slice(-HARNESS_DIAGNOSTIC_LIMIT),
              },
            },
            value: undefined,
          });
        })
        .pipe(Effect.withSpan('HarnessObservations.notedWords'));
    });
  }

  holdWords(threadId: string, sessionId: string, entry: HarnessHeldAnswer): Effect.Effect<void, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => this.holding(threadId, sessionId, entry, new Date(now).toISOString()));
  }

  private holding(threadId: string, sessionId: string, entry: HarnessHeldAnswer, at: string): Effect.Effect<void, HarnessFailure> {
    return this.store
      .change(threadId, (facet) => {
        const standing = facet.held;
        const stale = standing !== undefined && standing.session !== sessionId;
        const kept = standing === undefined || stale ? [] : standing.entries;
        if (kept.some((held) => held.turn === entry.turn)) return Effect.succeed({ facet, value: undefined });
        const full = kept.length >= HARNESS_HELD_LIMIT;
        const entries = [...kept, entry].slice(-HARNESS_HELD_LIMIT);
        const dropped: readonly HarnessDiagnostic[] = stale
          ? [
              {
                cause: 'words-dropped' as const,
                at,
                detail:
                  `${kept.length === 1 ? 'One answer' : `${kept.length} answers`} held for execution ${standing?.session} were dropped when ${sessionId} took its place.`.slice(
                    0,
                    HARNESS_DETAIL_MAX,
                  ),
              },
            ]
          : full
            ? [
                {
                  cause: 'words-dropped' as const,
                  at,
                  detail:
                    `The oldest held answer was dropped at the ${HARNESS_HELD_LIMIT}-answer ceiling; this execution has bound no root.`.slice(
                      0,
                      HARNESS_DETAIL_MAX,
                    ),
                },
              ]
            : [];
        return Effect.succeed({
          facet: {
            ...facet,
            held: { session: sessionId, entries },
            observation:
              dropped.length === 0
                ? facet.observation
                : {
                    ...facet.observation,
                    revision: facet.observation.revision + 1,
                    diagnostics: [...facet.observation.diagnostics, ...dropped].slice(-HARNESS_DIAGNOSTIC_LIMIT),
                  },
          },
          value: undefined,
        });
      })
      .pipe(Effect.withSpan('HarnessObservations.holdWords'));
  }

  releaseHeld(threadId: string, sessionId: string): Effect.Effect<HeldRelease, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => this.releasing(threadId, sessionId, new Date(now).toISOString()));
  }

  private releasing(threadId: string, sessionId: string, at: string): Effect.Effect<HeldRelease, HarnessFailure> {
    return this.store
      .change<HeldRelease>(threadId, (facet) => {
        const standing = facet.held;
        const bound = facet.observation.binding.rootKey;
        const session = facet.session;
        if (standing === undefined || standing.session !== sessionId || bound === null || session === undefined) {
          return Effect.succeed({ facet, value: { publish: [], session: null } });
        }
        const publish = standing.entries.filter((held) => held.rootKey === bound);
        const foreign = standing.entries.filter((held) => held.rootKey !== bound);
        const noted: readonly HarnessDiagnostic[] =
          foreign.length === 0
            ? []
            : [
                {
                  cause: 'foreign-root' as const,
                  at,
                  detail:
                    `${foreign.length === 1 ? 'One held answer named' : `${foreign.length} held answers named`} a session other than the bound root of this execution.`.slice(
                      0,
                      HARNESS_DETAIL_MAX,
                    ),
                },
              ];
        const { held: _gone, ...rest } = facet;
        return Effect.succeed({
          facet: {
            ...rest,
            observation:
              noted.length === 0
                ? facet.observation
                : {
                    ...facet.observation,
                    revision: facet.observation.revision + 1,
                    diagnostics: [...facet.observation.diagnostics, ...noted].slice(-HARNESS_DIAGNOSTIC_LIMIT),
                  },
          },
          value: { publish, session },
        });
      })
      .pipe(Effect.withSpan('HarnessObservations.releaseHeld'));
  }

  expireHeld(threadId: string, sessionId: string, proved: string | null): Effect.Effect<HeldExpiry, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) => this.expiring(threadId, sessionId, proved, new Date(now).toISOString()));
  }

  private expiring(threadId: string, sessionId: string, proved: string | null, at: string): Effect.Effect<HeldExpiry, HarnessFailure> {
    return this.store
      .change<HeldExpiry>(threadId, (facet) => {
        const standing = facet.held;
        const session = facet.session;
        if (standing === undefined || standing.session !== sessionId || standing.entries.length === 0 || session === undefined) {
          return Effect.succeed({ facet, value: { deliver: [], session: null } });
        }
        const deliver = proved === null ? standing.entries : standing.entries.filter((held) => held.rootKey === proved);
        const foreign = proved === null ? [] : standing.entries.filter((held) => held.rootKey !== proved);
        const unproven = proved === null ? standing.entries.length : 0;
        const noted: readonly HarnessDiagnostic[] = [
          ...(unproven === 0
            ? []
            : [
                {
                  cause: 'words-unproven' as const,
                  at,
                  detail:
                    `${unproven === 1 ? 'One answer' : `${unproven} answers`} went unproven: execution ${sessionId} ended and its export named no root; its retained output holds the turn.`.slice(
                      0,
                      HARNESS_DETAIL_MAX,
                    ),
                },
              ]),
          ...(foreign.length === 0
            ? []
            : [
                {
                  cause: 'foreign-root' as const,
                  at,
                  detail:
                    `${foreign.length === 1 ? 'One held answer named' : `${foreign.length} held answers named`} a session other than the one this launch's export proved.`.slice(
                      0,
                      HARNESS_DETAIL_MAX,
                    ),
                },
              ]),
        ];
        const { held: _gone, ...rest } = facet;
        return Effect.succeed({
          facet: {
            ...rest,
            observation:
              noted.length === 0
                ? facet.observation
                : {
                    ...facet.observation,
                    revision: facet.observation.revision + 1,
                    diagnostics: [...facet.observation.diagnostics, ...noted].slice(-HARNESS_DIAGNOSTIC_LIMIT),
                  },
          },
          value: { deliver, session },
        });
      })
      .pipe(Effect.withSpan('HarnessObservations.expireHeld'));
  }

  admit(facet: ExternalSession, event: HarnessEvent, adapter: HarnessAdapter): HarnessAccepted {
    const standing = facet.observation;
    const sessionId = facet.session?.id ?? null;
    const base =
      sessionId === standing.binding.sessionId
        ? standing
        : observationRebound(standing, { sessionId, execution: facet.execution, rootKey: null });
    if (event.receipt !== null && (facet.seen ?? []).includes(event.receipt)) {
      return {
        facet,
        receipt: { outcome: 'duplicate', revision: base.revision, cause: null, harness: facet.name, transport: 'terminal' as const },
      };
    }
    const at = event.observedAt;
    const refusals: HarnessDiagnostic[] = [];
    const note = (cause: HarnessDiagnostic['cause'], detail: string): void => {
      refusals.push({ cause, at, detail: detail.slice(0, HARNESS_DETAIL_MAX) });
    };
    const stop = (cause: HarnessDiagnostic['cause'], detail: string): HarnessAccepted => {
      note(cause, detail);
      return written(facet, base, {
        model: base.metadata.model,
        refusals,
        rootKey: base.binding.rootKey,
        workKey: base.binding.workKey,
        receipt: null,
        outcome: 'refused',
      });
    };

    if (event.sessionId !== null && event.sessionId !== sessionId) {
      return stop('stale-execution', 'This reading names an execution session that is not the one standing here.');
    }
    if (event.childId !== undefined) return stop('child-event', 'This event names a vendor child, not this execution’s root.');
    if (base.through !== undefined && event.observedAt <= base.through) {
      return stop('stale-evidence', 'This hook was captured no later than evidence already read; delivery cannot order it as newer.');
    }
    const proven = event.sessionId !== null && event.sessionId === sessionId;
    const bound = base.binding.rootKey;
    const root = rootOf(adapter, facet, base, event, proven);
    if (root === 'foreign') {
      return stop(
        'foreign-root',
        bound === null
          ? 'This reading names a root session other than the one this launch resumed.'
          : 'This reading names a root session other than the one this execution is bound to.',
      );
    }
    if (!proven) {
      note('execution-unproven', 'This reading names no execution session, so nothing in it is a current fact.');
    } else if (root === 'unproven') {
      note('root-unproven', 'This reading proves no root session, so nothing in it is a current root fact.');
    }
    const authoritative = proven && root !== 'unproven';
    const rootKey = root === 'binding' ? event.rootKey : bound;
    const workRoad = workBound(adapter, facet, base, event, proven, root);
    if (workRoad === 'foreign') {
      return stop('foreign-root', 'This reading names a session other than the one this execution bound its work clock to.');
    }
    const workKey = workRoad === 'binding' ? (event.rootKey ?? undefined) : base.binding.workKey;
    const workable = proven && workRoad !== 'unproven';
    const why: HarnessStale | null = !authoritative ? 'unproven-source' : null;
    const said = field(base.metadata.model, event.model, why);
    const model = sameField(base.metadata.model, said) ? base.metadata.model : said;
    const landed = written(facet, base, {
      model,
      refusals,
      rootKey,
      workKey,
      receipt: event.receipt,
      through: authoritative && refusals.length === 0 ? event.observedAt : undefined,
      outcome: workable ? 'admitted' : 'kept',
    });
    const life = landed.facet.session;
    if (!authoritative || event.transcriptPath === undefined || life === undefined || life.transcriptPath === event.transcriptPath) {
      return landed;
    }
    const revision = Math.max(landed.facet.observation.revision, base.revision + 1);
    return {
      facet: {
        ...landed.facet,
        session: { ...life, transcriptPath: event.transcriptPath },
        observation: { ...landed.facet.observation, revision },
      },
      receipt: { ...landed.receipt, outcome: 'admitted', revision },
    };
  }

  metadata(
    threadId: string,
    input: {
      readonly binding: HarnessBinding;
      readonly revision: number;
      readonly fields: HarnessObservation['metadata'];
    },
  ): Effect.Effect<HarnessReceipt, HarnessFailure> {
    return this.store
      .change<HarnessReceipt>(threadId, (facet) => {
        const standing = facet.observation;
        const refused = (cause: HarnessDiagnostic['cause']) =>
          Effect.succeed({
            facet,
            value: {
              outcome: 'refused' as const,
              revision: standing.revision,
              cause,
              harness: facet.name,
              transport: 'terminal' as const,
            },
          });
        if (input.revision !== standing.revision) return refused('stale-revision');
        if (
          !sameBinding(input.binding, standing.binding) ||
          input.binding.sessionId !== facet.session?.id ||
          input.binding.execution?.execution !== facet.execution?.execution ||
          input.binding.execution?.incarnation !== facet.execution?.incarnation
        )
          return refused('stale-execution');
        const scoped = input.binding.rootKey ?? input.binding.workKey ?? null;
        if (scoped === null) return refused('work-unproven');
        if (input.binding.execution === null || input.binding.sessionId === null) return refused('execution-unproven');
        if (facet.session?.state === 'ended') return refused('session-ended');
        if (facet.session?.state !== 'running' || facet.retiring === true)
          return refused(facet.session?.state === 'stopping' || facet.retiring === true ? 'session-stopping' : 'execution-unproven');
        for (const field of Object.values(input.fields)) {
          if ('scope' in field && field.scope.rootKey !== scoped) return refused('foreign-root');
        }
        const take = (before: HarnessField, after: HarnessField): HarnessField => {
          const source = sourceOf(after);
          if (
            before._tag === 'Value' &&
            before.claim !== 'last-recorded' &&
            (before.scope.turnId === null || before.scope.turnId === (facet.turn?.turn ?? null)) &&
            (after._tag !== 'Value' || after.claim === 'last-recorded') &&
            before.source !== source
          )
            return before;
          const next = field(before, after, null);
          return sameField(before, next) ? before : next;
        };
        const model = take(standing.metadata.model, input.fields.model);
        const effort = take(standing.metadata.effort, input.fields.effort);
        const title = take(standing.metadata.title, input.fields.title);
        const moved = model !== standing.metadata.model || effort !== standing.metadata.effort || title !== standing.metadata.title;
        const revision = moved ? standing.revision + 1 : standing.revision;
        return Effect.succeed({
          facet: moved ? { ...facet, observation: { ...standing, revision, metadata: { model, effort, title } } } : facet,
          value: {
            outcome: moved ? ('admitted' as const) : ('unchanged' as const),
            revision,
            cause: null,
            harness: facet.name,
            transport: 'terminal' as const,
          },
        });
      })
      .pipe(
        Effect.flatMap((receipt) => this.adopted(threadId, input, receipt)),
        Effect.tap((receipt) =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              occasion: 'metadata',
              cause: receipt.cause ?? undefined,
            });
            yield* Effect.withSpan(Effect.void, `HarnessObservations.${receipt.outcome}`);
            if (receipt.cause !== null) {
              yield* Effect.withSpan(Effect.void, `HarnessObservations.${receipt.outcome}.${receipt.cause}`);
            }
          }),
        ),
        Effect.withSpan('HarnessMetadata.cas'),
      );
  }

  bindWitness(threadId: string, sessionId: string, revision: number, rootKey: string): Effect.Effect<HarnessReceipt, HarnessFailure> {
    return this.store
      .change<HarnessReceipt>(threadId, (facet) => {
        const standing = facet.observation;
        const refused = (cause: HarnessDiagnostic['cause']) =>
          Effect.succeed({
            facet,
            value: {
              outcome: 'refused' as const,
              revision: standing.revision,
              cause,
              harness: facet.name,
              transport: 'terminal' as const,
            },
          });
        if (revision !== standing.revision) return refused('stale-revision');
        const session = facet.session;
        if (session === undefined || session.id !== sessionId) return refused('stale-execution');
        if (session.state === 'ended') return refused('session-ended');
        if (session.state !== 'running' || facet.retiring === true)
          return refused(session.state === 'stopping' || facet.retiring === true ? 'session-stopping' : 'execution-unproven');
        if (standing.binding.rootKey !== null) {
          return standing.binding.rootKey === rootKey
            ? Effect.succeed({
                facet,
                value: {
                  outcome: 'unchanged' as const,
                  revision: standing.revision,
                  cause: null,
                  harness: facet.name,
                  transport: 'terminal' as const,
                },
              })
            : refused('foreign-root');
        }
        const binding: HarnessBinding = { sessionId: session.id, execution: facet.execution, rootKey };
        const bound = standing.revision + 1;
        return Effect.succeed({
          facet: {
            ...facet,
            sessionKey: rootKey,
            observation: { ...standing, revision: bound, binding },
          },
          value: { outcome: 'admitted' as const, revision: bound, cause: null, harness: facet.name, transport: 'terminal' as const },
        });
      })
      .pipe(
        Effect.tap((receipt) =>
          Effect.gen(function* () {
            yield* Effect.annotateCurrentSpan({
              occasion: 'witness',
              cause: receipt.cause ?? undefined,
            });
            yield* Effect.withSpan(Effect.void, `HarnessObservations.${receipt.outcome}`);
            if (receipt.cause !== null) {
              yield* Effect.withSpan(Effect.void, `HarnessObservations.${receipt.outcome}.${receipt.cause}`);
            }
          }),
        ),
        Effect.withSpan('HarnessObservations.witness'),
      );
  }

  readonly titled = Effect.fnUntraced(function* (this: HarnessObservations, threadId: string, title: string) {
    for (let attempt = 0; attempt < TITLE_ATTEMPTS; attempt += 1) {
      const facet = yield* this.store.read(threadId);
      if (facet === null) return;
      const { binding, revision } = facet.observation;
      const scope = { rootKey: binding.rootKey ?? binding.workKey ?? null, turnId: null };
      const observedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      const receipt = yield* this.metadata(threadId, {
        binding,
        revision,
        fields: {
          model: { _tag: 'NotRead' },
          effort: { _tag: 'NotRead' },
          title: { _tag: 'Value', value: title, claim: 'serving', source: 'protocol', scope, observedAt },
        },
      });
      if (receipt.cause !== 'stale-revision') return;
    }
  });

  private adopted(
    threadId: string,
    input: { readonly binding: HarnessBinding; readonly fields: HarnessObservation['metadata'] },
    receipt: HarnessReceipt,
  ): Effect.Effect<HarnessReceipt, HarnessFailure> {
    const title = input.fields.title;
    if (receipt.outcome !== 'admitted' || title._tag !== 'Value' || title.value.trim() === '') return Effect.succeed(receipt);
    return Effect.as(this.adopt(threadId, input.binding, title.value), receipt);
  }

  private adopt(threadId: string, binding: HarnessBinding, title: string): Effect.Effect<void, HarnessFailure> {
    const { db, units, records, published, autoAdopt } = this;
    return Effect.gen(function* () {
      if (autoAdopt !== undefined && !(yield* autoAdopt(threadId))) return;
      const facts = yield* records.facts(threadId);
      if (facts === undefined) return;
      const landed = yield* adoptSessionTitle(db, units, records, threadId, title, facts.titleRevision, binding);
      if (landed && published !== undefined) yield* published(threadId);
    });
  }
}
