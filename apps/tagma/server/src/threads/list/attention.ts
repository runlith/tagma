import { keyOrder, type PageKey } from '@runlith/paging';
import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { ThreadList } from '../contract/service/list.js';
import {
  ATTENTION_LABEL_CHARS,
  ATTENTION_OPTIONS,
  ATTENTION_TEXT_CHARS,
  ATTENTION_VALUE_CHARS,
  type AttentionRow,
} from '../contract/wire/attention.js';
import type { ThreadAsk, ThreadAskOption } from '../contract/wire/list.js';
import { standingOf } from '../events/standing.js';
import { cutText } from './pendingAsk.js';
import type { ThreadSummary } from './summary.js';

export const ATTENTION_ORDER = ['desc', 'desc'] as const;

export const byRank = keyOrder(ATTENTION_ORDER);

export type Ranked = { readonly row: AttentionRow; readonly key: PageKey };

export const rankedOf = (row: AttentionRow): Ranked => {
  const at = Date.parse(row.at);
  return { row, key: [Number.isNaN(at) ? 0 : at, row.threadId] };
};

const brief = (text: string | null | undefined): string | null =>
  text === null || text === undefined ? null : cutText(text, ATTENTION_TEXT_CHARS);

function inboxOptions(ask: ThreadAsk): readonly ThreadAskOption[] {
  if ([...ask.text].length > ATTENTION_TEXT_CHARS || ask.options.length > ATTENTION_OPTIONS) return [];
  if (ask.options.some((option) => option.answers.some((answer) => answer.values.some((value) => value.length > ATTENTION_VALUE_CHARS))))
    return [];
  return ask.options.map((option) => ({ ...option, label: cutText(option.label, ATTENTION_LABEL_CHARS) }));
}

export function attentionRowOf(summary: ThreadSummary, project: AttentionRow['project']): AttentionRow | null {
  const standing = standingOf(summary);
  if (standing === null) return null;
  const placed = {
    project,
    threadId: summary.id,
    title: summary.title,
    name: summary.name,
    parentId: summary.parentThreadId,
    eventId: standing.eventId,
    at: standing.at,
    runId: standing.runId,
  };
  if (standing.kind === 'awaiting') {
    const ask = standing.ask;
    return {
      ...placed,
      kind: standing.kind,
      ask: {
        questionId: ask.questionId,
        text: cutText(ask.text, ATTENTION_TEXT_CHARS),
        kind: ask.kind,
        options: inboxOptions(ask),
      },
      said: null,
      failure: null,
    };
  }
  if (standing.kind === 'finished') return { ...placed, kind: standing.kind, ask: null, said: brief(summary.saidLine), failure: null };
  const { ending } = standing;
  return {
    ...placed,
    kind: standing.kind,
    ask: null,
    said: null,
    failure: {
      ending: ending.status,
      reason: brief(ending.failureReason),
      type: ending.failure?.type ?? null,
      detail: brief(ending.failure?.detail),
      httpStatus: ending.failure?.httpStatus ?? null,
    },
  };
}

const sameOptions = (left: AttentionRow['ask'], right: AttentionRow['ask']): boolean =>
  JSON.stringify(left?.options ?? null) === JSON.stringify(right?.options ?? null);

export function sameRow(left: AttentionRow, right: AttentionRow): boolean {
  return (
    left.threadId === right.threadId &&
    left.kind === right.kind &&
    left.eventId === right.eventId &&
    left.at === right.at &&
    left.runId === right.runId &&
    left.title === right.title &&
    left.name === right.name &&
    left.parentId === right.parentId &&
    left.project.id === right.project.id &&
    left.project.name === right.project.name &&
    left.ask?.text === right.ask?.text &&
    left.ask?.kind === right.ask?.kind &&
    left.ask?.questionId === right.ask?.questionId &&
    sameOptions(left.ask, right.ask) &&
    left.said === right.said &&
    left.failure?.ending === right.failure?.ending &&
    left.failure?.reason === right.failure?.reason &&
    left.failure?.type === right.failure?.type &&
    left.failure?.detail === right.failure?.detail &&
    left.failure?.httpStatus === right.failure?.httpStatus
  );
}

export const projectNames = (projects: Projects['Service']) => {
  let version = -1;
  let names = new Map<number, string>();
  return Effect.fnUntraced(function* (id: number) {
    const current = yield* projects.registryVersion;
    if (current !== version) {
      names = new Map((yield* projects.list()).map((row) => [row.id, row.name] as const));
      version = current;
    }
    const name = names.get(id);
    return name === undefined ? undefined : { id, name };
  });
};

export type ProjectNames = ReturnType<typeof projectNames>;

export const attentionRows = Effect.fnUntraced(function* (list: ThreadList['Service'], named: ProjectNames) {
  const ranked: Ranked[] = [];
  for (const summary of yield* list.attention()) {
    const project = yield* named(summary.projectId);
    if (project === undefined) continue;
    const row = attentionRowOf(summary, project);
    if (row !== null) ranked.push(rankedOf(row));
  }
  return ranked.sort((left, right) => byRank(left.key, right.key));
});
