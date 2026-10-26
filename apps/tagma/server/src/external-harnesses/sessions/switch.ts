import { Effect } from 'effect';
import { threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import type { TransportRegistry } from '@runlith/agent/thread/transport/contract';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadLookup } from '../../threads/contract/service/reads.js';
import { HarnessTurnStale, JOURNAL_MOVED, STALE_RETRIES } from '../../threads/contract/service/rebinding.js';
import type { ThreadRebinding } from '../../threads/contract/service/rebinding.js';
import type { HarnessName, HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import { writes } from '../../platform/contract/service/writes.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { gated } from '../../threads/projectGate.js';
import { acpKernel, terminalKernel } from '../birth/seat.js';
import { resolvedAsked } from '../birth/modelChoice.js';
import { currentEffort, currentModel } from '../../threads/contract/wire/harness/observation.js';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { harnessAdapter, servingProvider, transportOf, type HarnessTransportOffer } from '../contract/service/table.js';
import { TransportSwitch, type TransportSwitched } from '../contract/service/transport.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { releaseResource } from './release.js';

export function transportSwitch(
  records: ThreadRecords['Service'],
  lookup: ThreadLookup['Service'],
  store: HarnessSessionStore,
  rebinding: ThreadRebinding['Service'],
  transports: TransportRegistry,
  providers: ProviderRegistry['Service'],
): TransportSwitch['Service'] {
  const release = releaseResource(store, transports);
  const joined = writes('TransportSwitch.to', [], rebinding.writes);

  const seated = Effect.fnUntraced(function* (threadId: string) {
    const binding = yield* store.binding(threadId);
    if (binding === undefined) return null;
    const resource = (yield* Effect.orDie(transports.of(binding))).resource;
    if (resource === undefined) return null;
    const started = yield* Effect.result(resource.seated(threadId));
    if (started._tag === 'Success') return null;
    const cause = threadCauseOf(started.failure);
    return cause instanceof GateRefusal ? cause.reason : cause instanceof Error ? cause.message : String(cause);
  });

  const hostedAsked = Effect.fnUntraced(function* (threadId: string, name: HarnessName, transport: HarnessTransport) {
    const stored = yield* store.asked(threadId);
    const facet = yield* store.read(threadId);
    const { models } = yield* providers.catalog;
    const provider = servingProvider(name, transport);
    const reported = facet === null ? null : currentModel(facet.observation);
    const option = provider === null || reported === null ? undefined : models.modelsOf(provider).find((one) => one.id === reported);
    const effort = facet === null ? null : currentEffort(facet.observation);
    const rung = option?.reasoningOptions.some((offered) => offered.id === effort) === true ? effort : null;
    const kept = stored !== undefined && stored.model === option?.id ? stored.reasoning : null;
    const observed = option === undefined ? undefined : { model: option.id, reasoning: rung ?? kept };
    return resolvedAsked(models, provider, observed ?? stored);
  });

  const moved = Effect.fnUntraced(function* (
    threadId: string,
    name: HarnessName,
    from: HarnessTransport,
    offer: HarnessTransportOffer,
    plain: boolean,
    account: string | null,
  ) {
    const asked = offer.agent === null ? yield* store.asked(threadId) : yield* hostedAsked(threadId, name, offer.transport);
    const switches = yield* store.switches(threadId);
    const seat =
      offer.transport === 'acp'
        ? acpKernel(name, offer.agent, asked, switches, account)
        : terminalKernel(name, asked, plain, switches, account);
    const recorded = yield* rebinding.prepare(threadId, from, seat);
    return yield* store.change<TransportSwitched>(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          if (facet.retiring) return yield* new GateRefusal('session-deleting', 'This thread is being deleted.', ['finish deleting it']);
          if (harnessSessionActive(facet.session)) {
            return yield* new GateRefusal(
              'thread-running',
              `Thread ${threadId} holds a ${from} process; its transport changes only while none stands.`,
              ['stop_agent, then set_thread_transport again'],
            );
          }
          if (from === offer.transport) return { facet, value: { status: 'unchanged' as const, transport: offer.transport } };
          if (recorded !== null) {
            yield* recorded(unit).pipe(
              Effect.mapError((failure) =>
                failure instanceof HarnessTurnStale
                  ? new GateRefusal(JOURNAL_MOVED, failure.message, ['set_thread_transport again'])
                  : failure,
              ),
            );
          }
          return {
            facet,
            value: { status: 'switched' as const, transport: offer.transport, unstarted: null },
          };
        }),
      joined,
    );
  });

  return TransportSwitch.of({
    to: (threadId, projectId, actor, transport) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const row = yield* lookup.find(threadId, OPERATOR_PRINCIPAL);
          const standing = row?.harness ?? null;
          if (row === undefined || standing === null) {
            return yield* new GateRefusal(
              'not-a-harness-thread',
              `Thread ${threadId} runs an agent of this server; only a harness thread has a transport.`,
              ['name a thread opened as a harness type — harness:<name>'],
            );
          }
          const offer = yield* transportOf(standing.name, transport);
          const from: HarnessTransport = (yield* store.binding(threadId))?.adapter === 'acp' ? 'acp' : 'terminal';
          if (from === transport) return { status: 'unchanged', transport } satisfies TransportSwitched;
          const facet = yield* store.read(threadId);
          const profile = harnessAdapter(standing.name).acp;
          if (profile?.hosts !== null && profile !== undefined && !profile.sharedSessions) {
            return yield* new GateRefusal(
              'transport-unavailable',
              `${harnessAdapter(standing.name).label} keeps separate sessions on these transports.`,
              ['start a separate thread on the transport you need'],
            );
          }
          if (transport === 'acp' && (facet?.plain === true || facet?.home !== undefined || facet?.permissionMode !== undefined)) {
            return yield* new GateRefusal(
              'profile-transport',
              `Thread ${threadId} was born with a harness profile, which runs on the terminal transport only.`,
              ['keep this thread on terminal', 'start a thread in a project without threads.harnessProfile'],
            );
          }
          if (harnessSessionActive(facet?.session)) {
            const running = (yield* records.facts(threadId))?.runningRunId ?? null;
            if (running !== null) {
              return yield* new GateRefusal(
                'thread-running',
                `Thread ${threadId} is running ${running}; its transport changes between turns.`,
                ['move it once this turn ends', 'stop_agent, then set_thread_transport again'],
              );
            }
            yield* release(threadId);
          }
          const switched = yield* moved(threadId, standing.name, from, offer, facet?.plain === true, row.account).pipe(
            Effect.retry({ times: STALE_RETRIES, while: (failure) => failure instanceof GateRefusal && failure.code === JOURNAL_MOVED }),
          );
          return switched.status === 'switched' ? { ...switched, unstarted: yield* seated(threadId) } : switched;
        }),
      ),
  });
}
