import { Effect } from 'effect';
import { toolSearchReferences } from '../../agent/AgentDeferredTools';
import { Message } from '@runlith/llm/schema/messages';
import type { ModelCapacity, ProviderRequestLimits } from '@runlith/llm/models/description';
import type { ThreadPrunedToolCall } from '../storage/compaction';
import { HistoryIndex, resultTokens } from './historyIndex';
import { pictureKey } from './media';
import { omitEarlierMedia } from './overflow';
import { threadRequestCapacity, type ThreadCompactionPolicy } from './policy';
import type { ThreadCompactionText } from './text';

export type ThreadPruning = {
  readonly messages: readonly Message[];
  readonly cleared: ReadonlySet<string>;
  readonly stored: readonly Message[];
  readonly foldsRecord: boolean;
  readonly marks: readonly ThreadPrunedToolCall[];
};

export function omittedRecord(pruning: ThreadPruning, text: Pick<ThreadCompactionText, 'omittedMedia'>): ThreadPruning {
  const omitted = omitEarlierMedia(pruning.stored, text);
  return omitted.omittedMedia === 0 ? pruning : { ...pruning, stored: omitted.messages, foldsRecord: true };
}

export function retiredMarks(cleared: ReadonlySet<string>, basis: readonly Message[], keepFrom: number): readonly string[] {
  if (cleared.size === 0) return [];
  const surviving = new Set<string>();
  for (const message of basis.slice(keepFrom)) {
    if (message.role !== 'tool' && message.role !== 'assistant') continue;
    for (const part of message.content) {
      if (part.type === 'tool-result' || part.type === 'tool-call') surviving.add(part.id);
    }
  }
  return [...cleared].filter((toolCallId) => !surviving.has(toolCallId));
}

export type ThreadPruneLimits = {
  readonly protectTokens: number;
  readonly minimumTokens: number;
  readonly recentUserTurns: number;
  readonly pictures?: ThreadPictureBudget | undefined;
};

export type ThreadToolPruning = {
  readonly messages: readonly Message[];
  readonly prunedTokens: number;
  readonly prunedResults: number;
  readonly newlyPruned: readonly ThreadPrunedToolCall[];
  readonly prunedMedia: ReadonlySet<string>;
};

export function pruneToolOutputs(
  messages: readonly Message[],
  limits: ThreadPruneLimits,
  settled: ReadonlySet<string>,
  clearedOutput: string,
): ThreadToolPruning {
  return pruneIndexed(HistoryIndex.of(messages, clearedOutput), limits, settled, clearedOutput);
}

export function pruneIndexed(
  index: HistoryIndex,
  limits: ThreadPruneLimits,
  settled: ReadonlySet<string>,
  clearedOutput: string,
): ThreadToolPruning {
  const messages = index.messages;
  const pictures = limits.pictures === undefined ? NO_PICTURES : prunePictures(index, limits.pictures, settled);
  const pictured = pictures.calls;
  const decided = pictured.length === 0 ? settled : new Set([...settled, ...pictured.map((call) => call.toolCallId)]);
  const openings = index.openings;
  const reach =
    limits.recentUserTurns <= 0
      ? messages.length - 1
      : openings.length < limits.recentUserTurns
        ? -1
        : openings[openings.length - limits.recentUserTurns]!;
  let protectedTokens = 0;
  let freshTokens = 0;
  const fresh = new Map<string, number>();
  const results = index.results;
  for (let at = results.length - 1; at >= 0; at -= 1) {
    const { index: messageIndex, part, tokens } = results[at]!;
    if (messageIndex > reach) continue;
    if (decided.has(part.id)) continue;
    protectedTokens += tokens;
    if (protectedTokens <= limits.protectTokens) continue;
    freshTokens += tokens;
    fresh.set(part.id, tokens);
  }
  if (freshTokens <= limits.minimumTokens) fresh.clear();
  const newlyPruned = [...pictured, ...[...fresh].map(([toolCallId, tokens]) => ({ toolCallId, tokens }))];
  const clearing = fresh.size === 0 ? decided : new Set([...decided, ...fresh.keys()]);
  const touched = new Set<number>();
  for (const { index: messageIndex, part } of results) if (clearing.has(part.id)) touched.add(messageIndex);
  if (touched.size === 0) return { messages, prunedTokens: 0, prunedResults: 0, newlyPruned, prunedMedia: pictures.media };
  const applied = [...messages];
  let prunedTokens = 0;
  let prunedResults = 0;
  for (const messageIndex of touched) {
    const cleared = clearToolOutputs([messages[messageIndex]!], clearing, clearedOutput);
    applied[messageIndex] = cleared.messages[0]!;
    prunedTokens += cleared.prunedTokens;
    prunedResults += cleared.prunedResults;
  }
  return { messages: applied, prunedTokens, prunedResults, newlyPruned, prunedMedia: pictures.media };
}

export type ThreadPictureBudget = {
  readonly limits: ProviderRequestLimits;
  readonly sizes: ReadonlyMap<string, number>;
};

export function threadPictureBudget<E>(
  limits: ProviderRequestLimits | undefined,
  sizes: ((locations: readonly string[]) => Effect.Effect<ReadonlyMap<string, number>, E>) | undefined,
  history: HistoryIndex,
): Effect.Effect<ThreadPictureBudget | undefined, E> {
  const locations = locationsOf(history);
  if (limits === undefined || sizes === undefined || locations.length === 0) return Effect.succeed(undefined);
  return Effect.map(sizes(locations), (known) => ({ limits, sizes: known }));
}

const PICTURES_HIGH = 3 / 4;
const PICTURES_LOW = 1 / 4;

export function pictureLocations(messages: readonly Message[]): readonly string[] {
  return locationsOf(HistoryIndex.of(messages, ''));
}

function locationsOf(index: HistoryIndex): readonly string[] {
  const locations: string[] = [];
  for (const entry of index.media) {
    if (entry.kind === 'files') locations.push(...entry.uris);
    else if (typeof entry.data === 'string') locations.push(entry.data);
  }
  return locations;
}

type ThreadPicturePruning = {
  readonly calls: readonly ThreadPrunedToolCall[];
  readonly media: ReadonlySet<string>;
};

const NO_PICTURES: ThreadPicturePruning = { calls: [], media: new Set() };

type PictureCandidate = { readonly bytes: number; readonly media: number } & (
  | { readonly call: ThreadPrunedToolCall }
  | { readonly key: string }
);

function prunePictures(index: HistoryIndex, budget: ThreadPictureBudget, decided: ReadonlySet<string>): ThreadPicturePruning {
  const answered = index.answered;
  const turn = index.openings.at(-1) ?? index.messages.length;
  const encoded = (location: string): number => Math.ceil((budget.sizes.get(location) ?? 0) / 3) * 4;
  const candidates: PictureCandidate[] = [];
  const current: PictureCandidate[] = [];
  let bytes = 0;
  let media = 0;
  for (const entry of index.media) {
    if (entry.kind === 'picture') {
      const held = typeof entry.data === 'string' ? encoded(entry.data) : Math.ceil(entry.data.byteLength / 3) * 4;
      media += 1;
      bytes += held;
      if (entry.user && typeof entry.data === 'string') {
        (entry.index < turn ? candidates : current).push({ key: pictureKey(entry.index, entry.data), bytes: held, media: 1 });
      }
      continue;
    }
    if (decided.has(entry.part.id)) continue;
    const held = entry.uris.reduce((sum, location) => sum + encoded(location), 0);
    bytes += held;
    media += entry.uris.length;
    if (entry.index < answered)
      candidates.push({ call: { toolCallId: entry.part.id, tokens: entry.tokens }, bytes: held, media: entry.uris.length });
  }
  const within = (share: number): boolean => bytes <= budget.limits.bytes * share && media <= budget.limits.media * share;
  if (within(PICTURES_HIGH)) return NO_PICTURES;
  const calls: ThreadPrunedToolCall[] = [];
  const keys = new Set<string>();
  const take = (from: readonly PictureCandidate[], share: number): void => {
    for (const candidate of from) {
      if (within(share)) return;
      if ('call' in candidate) calls.push(candidate.call);
      else keys.add(candidate.key);
      bytes -= candidate.bytes;
      media -= candidate.media;
    }
  };
  take(candidates, PICTURES_LOW);
  take(current, PICTURES_HIGH);
  return { calls, media: keys };
}

export function threadPruneProtection(
  capacity: ModelCapacity,
  policy: Pick<ThreadCompactionPolicy, 'toolPruneProtectShare'>,
): { readonly protectTokens: number; readonly minimumTokens: number } {
  const protectTokens = Math.round(policy.toolPruneProtectShare * threadRequestCapacity(capacity));
  return { protectTokens, minimumTokens: protectTokens / 2 };
}

export function clearToolOutputs(
  messages: readonly Message[],
  cleared: ReadonlySet<string>,
  clearedOutput: string,
): {
  messages: readonly Message[];
  prunedTokens: number;
  prunedResults: number;
  changed: boolean;
} {
  if (cleared.size === 0) return { messages, prunedTokens: 0, prunedResults: 0, changed: false };
  let prunedTokens = 0;
  let prunedResults = 0;
  const reads = (result: unknown): boolean =>
    typeof result === 'object' &&
    result !== null &&
    (result as { type?: unknown }).type === 'text' &&
    (result as { value?: unknown }).value === clearedOutput;
  const projected = messages.map((message): Message => {
    if (message.role !== 'tool' && message.role !== 'assistant') return message;
    if (!message.content.some((part) => part.type === 'tool-result' && cleared.has(part.id) && !reads(part.result))) {
      return message;
    }
    const content = message.content.map((part) => {
      if (part.type !== 'tool-result' || !cleared.has(part.id) || reads(part.result)) return part;
      prunedResults += 1;
      prunedTokens += resultTokens(part.result);
      const references = toolSearchReferences(part);
      return {
        ...part,
        toolReferences: references.length === 0 ? part.toolReferences : [...references],
        result: { type: 'text' as const, value: clearedOutput },
      };
    });
    return Message.make({ ...message, content });
  });
  return { messages: projected, prunedTokens, prunedResults, changed: prunedResults > 0 };
}
