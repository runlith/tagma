import { Clock, Effect, type FileSystem } from 'effect';
import type { ClientEvent } from '@runlith/acp/events';
import type { JournalRuns, LaunchGuidance, RunLaunch } from '@runlith/agent/thread/transport/contract';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { chosenSwitches } from '@runlith/llm/models/description';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { launchChoice, resolvedAsked } from '../birth/modelChoice.js';
import type { VendorTurns } from '../store/turns.js';
import { REWIND } from '@runlith/hosted-runner/wire/extensions';
import type { ProtocolHalts } from './halts.js';
import type { ProtocolLaunches } from './launches.js';
import type { Link } from './links.js';
import type { SessionPlace } from './prompts.js';
import { IDLE, type Persisted, type ProtocolSteps } from './steps.js';

const merged = (first: Persisted, second: Persisted): Persisted => ({
  events: [...first.events, ...second.events],
  begun: [...first.begun, ...second.begun],
  ended: [...first.ended, ...second.ended],
  endings: [...first.endings, ...second.endings],
});

export class ProtocolAlignment {
  constructor(
    private readonly steps: ProtocolSteps,
    private readonly halts: ProtocolHalts,
    private readonly turns: VendorTurns,
    private readonly launches: ProtocolLaunches,
    private readonly journal: JournalRuns,
    private readonly guidance: LaunchGuidance,
    private readonly providers: ProviderRegistry['Service'],
    private readonly files: FileSystem.FileSystem,
    private readonly place: SessionPlace,
  ) {}

  readonly align = Effect.fnUntraced(function* (this: ProtocolAlignment, link: Link, launch: RunLaunch | undefined) {
    const key = link.facet.sessionKey;
    if (key === null) {
      const cwd = yield* this.cwd(link);
      return cwd === null ? IDLE : yield* this.fresh(link, cwd);
    }
    const cut = yield* this.cut(link, key);
    if (cut !== null) return cut;
    return launch === undefined ? null : yield* this.configure(link, key, launch);
  });

  readonly cwd = Effect.fnUntraced(function* (this: ProtocolAlignment, link: Link) {
    const asked = link.profile.hosts === null ? (link.facet.session?.cwd ?? '') : (yield* this.place(link.threadId)).root;
    if (!link.profile.sharedSessions || asked === '') return asked;
    const { halts } = this;
    return yield* Effect.matchEffect(this.files.realPath(asked), {
      onFailure: (cause) =>
        Effect.as(
          halts.failed(
            link,
            new GateRefusal(
              'harness-directory-unreadable',
              `The shared session directory ${asked} could not be resolved: ${cause.message}`,
              ['restore access to the directory or start the thread in an existing directory'],
            ),
          ),
          null,
        ),
      onSuccess: (path) => Effect.succeed(path),
    });
  });

  readonly fresh = Effect.fnUntraced(function* (this: ProtocolAlignment, link: Link, cwd: string) {
    const { steps, turns, guidance } = this;
    if (link.profile.hosts === null) guidance.reset(link.threadId, link.facet.sessionKey !== null);
    const standing = yield* Effect.mapError(this.journal.kept(link.threadId), threadCallFailed);
    return yield* steps.intend(
      link,
      { _tag: 'NewSession', params: { cwd, mcpServers: [] } },
      {
        row: (row) => ({ ...row, phase: 'opening', cut: null, fork: null }),
        within: (facet, unit, row) =>
          Effect.as(turns.based(unit, link.threadId, standing), {
            facet: {
              ...facet,
              sessionKey: null,
              observation: { ...facet.observation, binding: { ...facet.observation.binding, rootKey: null } },
            },
            row,
          }),
      },
    );
  });

  readonly refused = Effect.fnUntraced(function* (
    this: ProtocolAlignment,
    link: Link,
    event: Extract<ClientEvent, { readonly _tag: 'RequestFailed' }>,
  ) {
    const request = event.request;
    if (request.meaning !== 'configure') return null;
    link.tried.delete(request.configId);
    const owed = this.launches.owing(link.threadId);
    if (owed === undefined) return null;
    const said = event.cause._tag === 'Agent' ? event.cause.error.message : event.cause._tag;
    return yield* this.refuse(
      link,
      owed,
      new GateRefusal('model-unavailable', `${link.name} refused ${request.configId} for this session: ${said}`, [
        'choose a model and effort the agent offers',
      ]),
    );
  });

  private readonly cut = Effect.fnUntraced(function* (this: ProtocolAlignment, link: Link, key: string) {
    if (!link.profile.proves.rewind) return null;
    const standing = link.row.cut;
    if (standing !== null && standing.request !== null) return IDLE;
    const cut = yield* Effect.mapError(this.journal.cut(link.threadId), threadCallFailed);
    const point = yield* this.turns.point(link.threadId, cut, null);
    if (point._tag === 'None') return null;
    if (point._tag === 'Fresh' || standing?.at === point.run || !link.row.client.extensions.includes(REWIND)) {
      const cwd = yield* this.cwd(link);
      return cwd === null ? IDLE : yield* this.fresh(link, cwd);
    }
    this.guidance.reset(link.threadId, false);
    return yield* this.steps.intend(
      link,
      { _tag: 'Extend', method: REWIND, envelopes: [], params: { sessionId: key, turn: point.address } },
      { row: (row, request) => (request === null ? row : { ...row, cut: { at: point.run, request } }) },
    );
  });

  readonly asked = Effect.fnUntraced(function* (this: ProtocolAlignment, thread: ThreadRow) {
    const { models } = yield* this.providers.catalog;
    const { provider, model, reasoning } = thread;
    return { models, asked: resolvedAsked(models, provider, model === null ? undefined : { model, reasoning: reasoning ?? null }) };
  });

  private readonly configure = Effect.fnUntraced(function* (this: ProtocolAlignment, link: Link, key: string, launch: RunLaunch) {
    const { models, asked } = yield* this.asked(launch.thread);
    const chosen = yield* Effect.result(launchChoice(models, link.adapter, asked, 'acp'));
    if (chosen._tag === 'Failure') return yield* this.refuse(link, launch, chosen.failure);
    link.asked = asked;
    const { provider, switches } = launch.thread;
    const option =
      asked === undefined || provider === null || !models.registered(provider)
        ? undefined
        : models.modelsOf(provider).find((one) => one.id === asked.model);
    let persisted: Persisted | null = null;
    const configured = link.row.configured;
    for (const choice of link.profile.configure(chosen.success, chosenSwitches(option?.switches ?? [], switches))) {
      const standing = configured === null ? null : configured[choice.configId];
      if (standing === undefined) continue;
      if (standing === choice.value) {
        link.tried.delete(choice.configId);
        continue;
      }
      const doubted = link.row.client.requests.some(
        (request) => request.meaning === 'configure' && request.uncertain && request.configId === choice.configId,
      );
      if (!doubted && link.tried.get(choice.configId) === choice.value) continue;
      link.tried.set(choice.configId, choice.value);
      const sent = yield* this.steps.intend(link, {
        _tag: 'Configure',
        params: { sessionId: key, configId: choice.configId, value: choice.value },
      });
      persisted = persisted === null ? sent : merged(persisted, sent);
    }
    return persisted;
  });

  private readonly refuse = Effect.fnUntraced(function* (this: ProtocolAlignment, link: Link, launch: RunLaunch, refusal: GateRefusal) {
    const run = launch.run.id;
    this.launches.finish(run);
    yield* this.steps.close(
      link.threadId,
      link.name,
      {
        turn: run,
        at: new Date(yield* Clock.currentTimeMillis).toISOString(),
        status: 'failed',
        failure: `${refusal.code}: ${refusal.reason} — ${refusal.unblock.join('; ')}`,
        stoppedBy: null,
        launch: 'lasting',
      },
      launch.seed.length === 0 ? [] : [{ fate: 'returned', turn: run, items: launch.seed.map((item) => item.id) }],
    );
    return IDLE;
  });
}
