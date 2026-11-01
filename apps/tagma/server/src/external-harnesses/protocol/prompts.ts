import { Clock, Effect, Option } from 'effect';
import type { ContentBlock } from '@runlith/acp/content';
import {
  isReaderWordsItem,
  keptWordsOf,
  openingWords,
  queuedTurnText,
  waitsForTurn,
  type ThreadCompactionRequest,
} from '@runlith/agent/thread/inboxItems';
import type { GuidanceNote, GuidanceSources, LaunchGuidance, PromptGuidance, RunLaunch } from '@runlith/agent/thread/transport/contract';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import { compactionEntryId } from '@runlith/agent/transcript/entryNames';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { Attachments } from '../../threads/contract/service/attachments.js';
import type { CompactionPlanning } from '../../threads/contract/service/compaction.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { currentModel } from '../../threads/contract/wire/harness/observation.js';
import { WAITING_REASONS } from '../../threads/contract/wire/waiting.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { ProtocolAlignment } from './alignment.js';
import { COMPACT, COMPACTING, STEER, WITHDRAW } from '@runlith/hosted-runner/wire/extensions';
import type { ProtocolJournal } from './journal.js';
import type { CompactionOrder, ProtocolLaunches } from './launches.js';
import type { Link } from './links.js';
import type { ExtensionRequest } from './methods/declaration.js';
import { itemBlocks } from './pictures.js';
import type { ProtocolPreparing } from './preparing.js';
import { negotiating, prompting, type OpenedTurn, type ProtocolRow } from './row.js';
import { IDLE, type Issued, type Persisted, type ProtocolSteps } from './steps.js';
import type { AccountSelection } from '../sessions/launch.js';
import { servingProvider } from '../contract/service/table.js';
import { acpCapabilities } from '../birth/seat.js';

const merged = (first: Persisted, second: Persisted): Persisted => ({
  events: [...first.events, ...second.events],
  begun: [...first.begun, ...second.begun],
  ended: [...first.ended, ...second.ended],
  endings: [...first.endings, ...second.endings],
});

export type SessionPlace = (threadId: string) => Effect.Effect<
  {
    projectId: number;
    root: string;
    scratch?: string;
    selection?: AccountSelection;
  },
  HarnessFailure
>;

export type LaunchWords = {
  readonly guided: PromptGuidance;
  readonly said: readonly (readonly ContentBlock[])[];
};

export type SteerWords = { readonly said: readonly ContentBlock[]; readonly noted: GuidanceNote | null };

const saidByReader = (item: ThreadInboxItem): boolean => isReaderWordsItem(item) && (item.kind !== 'turn' || item.sender.kind === 'reader');

const steersOf = (row: ProtocolRow): readonly ExtensionRequest[] =>
  row.client.requests.filter(
    (request): request is ExtensionRequest => request.meaning === 'extension' && request.method === STEER && !request.uncertain,
  );

export const readsMidTurn = (link: Link): boolean =>
  link.profile.midTurn === 'steer' &&
  link.row.client.extensions.includes(STEER) &&
  link.row.client.requests.some((request) => request.meaning === 'prompt');

const stepsMidTurn = (link: Link): boolean =>
  link.profile.proves.compaction === true &&
  link.row.compact === null &&
  link.row.client.extensions.includes(COMPACTING) &&
  link.row.client.requests.some((request) => request.meaning === 'prompt' && !request.cancelled);

export class ProtocolPrompts {
  constructor(
    private readonly steps: ProtocolSteps,
    private readonly launches: ProtocolLaunches,
    private readonly inbox: ThreadInbox['Service'],
    private readonly journal: ProtocolJournal,
    private readonly planning: CompactionPlanning['Service'],
    private readonly pictures: Attachments['Service'],
    private readonly place: SessionPlace,
    private readonly compacts: (threadId: string) => Effect.Effect<void>,
    private readonly guidance: LaunchGuidance,
    private readonly sources: GuidanceSources,
    private readonly alignment: ProtocolAlignment,
    private readonly launched: ProtocolPreparing<LaunchWords>,
    private readonly steered: ProtocolPreparing<SteerWords>,
  ) {}

  due(threadId: string): boolean {
    return this.launched.due(threadId) || this.steered.due(threadId);
  }

  pumped(threadId: string): void {
    this.launched.pumped(threadId);
    this.steered.pumped(threadId);
  }

  readonly prompt = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link) {
    const { launches } = this;
    const facet = link.facet;
    if (
      link.row.phase !== 'ready' ||
      link.row.failure !== null ||
      link.poisoned !== null ||
      link.refused !== null ||
      link.row.client.stopping !== null
    )
      return IDLE;
    if (negotiating(link.row) || facet.session?.state !== 'running') return IDLE;
    if (prompting(link.row)) {
      const waiting = launches.owing(link.threadId)?.run ?? launches.compactionOwed(link.threadId)?.run;
      if (waiting !== undefined && launches.waits(waiting.id))
        yield* this.journal.live(waiting, { op: 'phase', phase: 'opening', waiting: { reason: WAITING_REASONS.stopping, place: null } });
      return yield* this.midTurn(link);
    }
    if (link.stale) return IDLE;
    const owed = launches.owing(link.threadId);
    const ordered = owed === undefined ? launches.compactionOwed(link.threadId) : undefined;
    if (owed === undefined && ordered === undefined) return IDLE;
    const aligning = yield* this.alignment.align(link, owed);
    if (aligning !== null) return aligning;
    if (owed === undefined) return ordered === undefined ? IDLE : yield* this.compacting(link, ordered);
    const launched = yield* this.launching(link, owed);
    return prompting(link.row) ? merged(launched, yield* this.midTurn(link)) : launched;
  });

  private readonly midTurn = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link) {
    const steps = stepsMidTurn(link);
    const reads = readsMidTurn(link);
    if (!steps && !reads) return IDLE;
    const launch = yield* this.inbox.launchItems(link.threadId);
    const asked = launch.compactions.filter((request) => request.body.at === 'step');
    const stepped = steps && asked.length > 0 ? yield* this.stepped(link, asked, 'manual') : IDLE;
    if (!reads || launch.readable.every(waitsForTurn)) return stepped;
    const steered = yield* this.steer(link, launch.readable);
    return merged(stepped, steered);
  });

  readonly afterTurn = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link, ended: readonly OpenedTurn[]) {
    const { launches, compacts } = this;
    let persisted = IDLE;
    let worded = false;
    for (const turn of ended) {
      persisted = merged(persisted, yield* this.returning(link, turn.id));
      if (!launches.finish(turn.id)) worded = true;
    }
    const next = merged(persisted, yield* this.prompt(link));
    if (worded && link.row.turns.length === 0 && (yield* this.overflowing(link))) {
      yield* compacts(link.threadId);
    }
    return next;
  });

  readonly delivered = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link, runId: string) {
    const sent = yield* this.prompt(link);
    const leads = link.row.turns.some((turn) => turn.id === runId) || this.launches.owing(link.threadId)?.run.id === runId;
    return leads ? sent : merged(sent, yield* this.returning(link, runId));
  });

  private readonly returning = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link, runId: string) {
    const { launches, inbox, steps, journal } = this;
    const handed = launches.handedOf(runId);
    if (handed.size === 0) return IDLE;
    const readable = (yield* inbox.launchItems(link.threadId)).readable;
    const unsent = readable.filter((item) => handed.has(item.id)).map((item) => item.id);
    if (unsent.length === 0) return IDLE;
    launches.settle(runId, unsent);
    return yield* steps.persist(link, { reports: [journal.fated({ id: runId, threadId: link.threadId }, 'returned', unsent)] });
  });

  private readonly launchWords = Effect.fn('ProtocolPrompts.launchWords')(function* (
    this: ProtocolPrompts,
    threadId: string,
    launch: RunLaunch,
    taken: boolean,
  ) {
    const texts = launch.seed.map((item) => queuedTurnText([item]));
    const projectId = (yield* this.place(threadId)).projectId;
    const inputs = launch.seed.filter(saidByReader).map((item) => item.id);
    const guided = yield* launch.guidance
      .prompt(launch.thread, launch.run, { projectId, inputs }, this.sources)
      .pipe(Effect.mapError(threadCallFailed));
    const said = yield* Effect.forEach(launch.seed, (item, index) =>
      itemBlocks(this.pictures, threadId, Effect.succeed(projectId), item, texts[index]!, taken),
    );
    const words: LaunchWords = { guided, said };
    return words;
  });

  private readonly launching = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link, launch: RunLaunch) {
    const { launches, inbox, steps, journal, launched } = this;
    const key = link.facet.sessionKey;
    if (key === null) return IDLE;
    const turn = launch.run.id;
    const taken = link.row.agent?.image === true;
    const prepared = `${turn}|${taken}`;
    launched.kept(link.threadId, (standing) => standing === prepared);
    const ready = yield* launched.ready(link.threadId, prepared, this.launchWords(link.threadId, launch, taken));
    if (Option.isNone(ready) || !launches.issue(turn)) return IDLE;
    launched.taken(link.threadId, prepared);
    const { guided, said } = ready.value;
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const ids = launch.seed.map((item) => item.id);
    const prompt: ContentBlock[] = [
      ...guided.texts.filter((text) => text !== '').map((text): ContentBlock => ({ type: 'text', text })),
      ...said.flat(),
      ...(guided.tail === null ? [] : [{ type: 'text' as const, text: guided.tail.text }]),
    ];
    const sent = yield* Effect.result(
      steps.intend(
        link,
        { _tag: 'Prompt', turn, envelopes: ids, params: { sessionId: key, prompt, _meta: { 'tagma/turn': turn } } },
        {
          row: (row) => ({
            ...row,
            turns: [
              ...row.turns,
              {
                id: turn,
                startedAt: at,
                parts: { text: 0, reasoning: 0 },
                assistant: [],
                said: '',
                words: openingWords(launch.seed)
                  .map((item) => queuedTurnText([item]))
                  .join('\n\n'),
                recorded: false,
                noted: guided.tail?.frame,
              },
            ],
          }),
          started: [{ turn, model: currentModel(link.facet.observation), kind: 'turn' }],
          reports: guided.events.length === 0 ? [] : [journal.guided({ id: turn, threadId: link.threadId }, guided.events)],
          within: Effect.fnUntraced(function* (current: ExternalSession, unit: WriteUnit<'machine'>, row: ProtocolRow) {
            const reserved = yield* inbox.reserveInput(link.threadId, ids, turn, current.execution, unit);
            if (reserved.length !== ids.length) {
              return yield* new GateRefusal('input-moved', 'Words of this prompt were taken by another act while it was written.', [
                'send the prompt again over the queue as it stands',
              ]);
            }
            return { facet: current, row };
          }),
        },
      ),
    );
    if (sent._tag === 'Success') {
      launches.sent(link.threadId, turn);
      yield* guided.delivered;
      return sent.success;
    }
    if (!(sent.failure instanceof GateRefusal && sent.failure.code === 'input-moved')) return yield* Effect.fail(sent.failure);
    launches.finish(turn);
    yield* steps.close(link.threadId, link.name, {
      turn,
      at,
      status: 'failed',
      failure: sent.failure.reason,
      stoppedBy: null,
      launch: 'passing',
    });
    return IDLE;
  });

  withdraw(link: Link, input: string): Effect.Effect<Issued | null, HarnessFailure> {
    const key = link.facet.sessionKey;
    const steered = steersOf(link.row).some((request) => request.envelopes.includes(input));
    if (!steered || key === null || !link.row.client.extensions.includes(WITHDRAW)) return Effect.succeed(null);
    return this.steps.intend(link, { _tag: 'Extend', method: WITHDRAW, params: { sessionId: key, input }, envelopes: [input] });
  }

  private readonly steerWords = Effect.fn('ProtocolPrompts.steerWords')(function* (
    this: ProtocolPrompts,
    threadId: string,
    turn: string,
    item: ThreadInboxItem,
    taken: boolean,
  ) {
    const projectId = (yield* this.place(threadId)).projectId;
    const said = yield* itemBlocks(this.pictures, threadId, Effect.succeed(projectId), item, queuedTurnText([item]), taken);
    const noted = saidByReader(item)
      ? yield* this.guidance.notes(threadId, turn, { projectId, inputs: [item.id] }, this.sources).pipe(Effect.mapError(threadCallFailed))
      : null;
    const words: SteerWords = { said, noted };
    return words;
  });

  private readonly steer = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link, readable: readonly ThreadInboxItem[]) {
    const { inbox, steps, steered } = this;
    const running = link.row.client.requests.find((request) => request.meaning === 'prompt');
    const key = link.facet.sessionKey;
    if (running?.meaning !== 'prompt' || running.cancelled || key === null) return IDLE;
    const turn = running.turn;
    const taken = link.row.agent?.image === true;
    steered.kept(link.threadId, (standing) => standing.startsWith(`${turn}|`));
    let persisted = IDLE;
    let waiting = false;
    for (const item of readable) {
      const prepared = `${turn}|${item.id}|${taken}`;
      const ready = yield* steered.ready(link.threadId, prepared, this.steerWords(link.threadId, turn, item, taken));
      if (waiting || Option.isNone(ready)) {
        waiting = true;
        continue;
      }
      steered.taken(link.threadId, prepared);
      const { said, noted } = ready.value;
      const prompt = noted === null ? said : [...said, { type: 'text' as const, text: noted.text }];
      const sent = yield* steps
        .intend(
          link,
          { _tag: 'Extend', method: STEER, params: { sessionId: key, prompt, input: item.id }, envelopes: [item.id] },
          {
            row: (row, request) =>
              request === null ? row : { ...row, steering: [...row.steering, { request, turn, noted: noted?.frame }] },
            within: Effect.fnUntraced(function* (current: ExternalSession, unit: WriteUnit<'machine'>, row: ProtocolRow) {
              const claimed = yield* inbox.claimInput(link.threadId, [item.id], turn, current.execution, unit);
              if (claimed.length === 0) {
                return yield* new GateRefusal('input-moved', 'These words were taken by another act while they were steered.', [
                  'send the words again over the queue as it stands',
                ]);
              }
              return { facet: current, row };
            }),
          },
        )
        .pipe(
          Effect.catchIf(
            (failure) => failure instanceof GateRefusal && failure.code === 'input-moved',
            () => Effect.succeed(null),
          ),
        );
      if (sent === null) continue;
      persisted = merged(persisted, sent);
    }
    return persisted;
  });

  private readonly compacting = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link, order: CompactionOrder) {
    const { launches, steps } = this;
    if (link.row.compact !== null || link.row.turns.length !== 0) return IDLE;
    const turn = order.run.id;
    const mode = order.mode;
    const model = currentModel(link.facet.observation);
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    if (!link.row.client.extensions.includes(COMPACT)) {
      launches.finish(turn);
      const failure = 'The agent did not announce compaction support.';
      return yield* steps.persist(link, {
        started: [{ turn, model, kind: 'compaction' }],
        ended: [{ turn, at, status: 'failed', failure, stoppedBy: null }],
        boundaries: [
          {
            type: 'compaction',
            id: compactionEntryId(turn),
            runId: turn,
            mode,
            status: 'failed',
            occurredAt: at,
            updatedAt: at,
          },
        ],
      });
    }
    if (link.facet.sessionKey === null || !launches.issue(turn)) return IDLE;
    const sent = yield* steps.intend(
      link,
      {
        _tag: 'Extend',
        method: COMPACT,
        envelopes: [],
        params: { sessionId: link.facet.sessionKey, at: 'end', instructions: this.instructed(order.keep) },
      },
      {
        started: [{ turn, model, kind: 'compaction' }],
        boundaries: [
          { type: 'compaction', id: compactionEntryId(turn), runId: turn, mode, status: 'running', occurredAt: at, updatedAt: at },
        ],
        row: (row, request) => ({
          ...row,
          compact: request === null ? row.compact : { turn, request, ids: [], mode, noticed: false },
          turns: [
            ...row.turns,
            {
              id: turn,
              startedAt: at,
              parts: { text: 0, reasoning: 0 },
              assistant: [],
              said: '',
              words: '',
              recorded: true,
            },
          ],
        }),
        within: (facet, _unit, row) => Effect.succeed({ facet, row }),
      },
    );
    launches.sent(link.threadId, turn);
    return sent;
  });

  readonly measured = Effect.fnUntraced(function* (this: ProtocolPrompts, link: Link) {
    if (!stepsMidTurn(link) || !(yield* this.overflowing(link))) return IDLE;
    return yield* this.stepped(link, [], 'automatic');
  });

  private readonly stepped = Effect.fnUntraced(function* (
    this: ProtocolPrompts,
    link: Link,
    requests: readonly ThreadCompactionRequest[],
    mode: 'manual' | 'automatic',
  ) {
    const { inbox, steps } = this;
    const running = link.row.client.requests.find((request) => request.meaning === 'prompt');
    const key = link.facet.sessionKey;
    if (running?.meaning !== 'prompt' || running.cancelled || key === null) return IDLE;
    const turn = running.turn;
    const ids = requests.map((request) => request.id);
    const sent = yield* Effect.result(
      steps.intend(
        link,
        {
          _tag: 'Extend',
          method: COMPACT,
          envelopes: ids,
          params: { sessionId: key, at: 'step', instructions: this.instructionsOf(requests) },
        },
        {
          row: (row, request) =>
            request === null ? row : { ...row, compact: { turn, request, ids, mode, noticed: false, inTurn: 'armed' } },
          reports: [this.journal.handed({ id: turn, threadId: link.threadId }, ids)],
          within: Effect.fnUntraced(function* (current: ExternalSession, unit: WriteUnit<'machine'>, row: ProtocolRow) {
            const claimed = yield* inbox.claimInput(link.threadId, ids, turn, current.execution, unit);
            if (claimed.length !== ids.length) {
              return yield* new GateRefusal('input-moved', 'This compaction request was taken by another act while it was sent.', [
                'send the request again over the queue as it stands',
              ]);
            }
            return { facet: current, row };
          }),
        },
      ),
    );
    if (sent._tag === 'Success') return sent.success;
    if (sent.failure instanceof GateRefusal && sent.failure.code === 'input-moved') return IDLE;
    return yield* Effect.fail(sent.failure);
  });

  private overflowing(link: Link): Effect.Effect<boolean, HarnessFailure> {
    const measured = link.row.context;
    const provider = servingProvider(link.adapter, 'acp');
    if (measured === null || provider === null || link.profile.proves.compaction === false) return Effect.succeed(false);
    const model = currentModel(link.facet.observation);
    return Effect.map(
      this.planning.threshold(link.threadId, provider, model, measured.size, acpCapabilities(link.profile).compaction),
      (threshold) => threshold !== null && measured.used >= threshold,
    );
  }

  private instructionsOf(requests: readonly ThreadCompactionRequest[]): string {
    return this.instructed(keptWordsOf(requests.map((request) => request.body.keep)));
  }

  private instructed(keep: string | undefined): string {
    return this.planning.instructions + (keep === undefined ? '' : `\n\nKeep: ${keep}`);
  }
}
