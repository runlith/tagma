import type { Git } from '@runlith/git/Git';
import { run } from '@runlith/git/repository';
import { Effect } from 'effect';
import type { HistoryAsk, HistoryEntry, HistoryPage, HistoryQuery } from './asks.js';
import { gitUnread, Unread } from './unread.js';

type Past = { readonly commit: string; readonly parents: readonly string[] };
type HeldHistory = { readonly entries: readonly HistoryEntry[]; at: number };

const histories = new Map<string, HeldHistory>();
const PAGE = 64;
const CLOSED: HistoryPage = { entries: [], done: true };

const listed = Effect.fn('inspecting.historyListing')(function* (git: Git['Service'], query: HistoryQuery) {
  const { after } = query;
  const text = yield* run(
    git,
    query.root,
    ['rev-list', '--reverse', '--topo-order', '--parents', '--end-of-options', query.head, ...(after === undefined ? [] : [`^${after}`])],
    undefined,
  ).pipe(Effect.mapError(gitUnread));
  return text
    .split('\n')
    .filter(Boolean)
    .map((line): Past => {
      const [commit = '', ...parents] = line.split(' ');
      return { commit, parents };
    });
});

const opened = Effect.fn('enforcement.originHistory')(function* (git: Git['Service'], query: HistoryQuery) {
  const history = yield* listed(git, query);
  const children = new Map<string, number>();
  for (const one of history) for (const parent of one.parents) children.set(parent, (children.get(parent) ?? 0) + 1);
  const entries: HistoryEntry[] = [];
  for (const one of history) {
    const forget: string[] = [];
    for (const parent of one.parents) {
      const left = (children.get(parent) ?? 1) - 1;
      children.set(parent, left);
      if (left === 0) forget.push(parent);
    }
    if (!children.has(one.commit)) forget.push(one.commit);
    entries.push({ commit: one.commit, parent: one.parents[0], forget });
  }
  return { entries, at: 0 } satisfies HeldHistory;
});

export const historyAt = Effect.fn('inspecting.historyAt')(function* (git: Git['Service'], ask: HistoryAsk) {
  if (ask.phase === 'close') {
    histories.delete(ask.job);
    return { worked: { history: CLOSED }, read: [] };
  }
  const held = ask.phase === 'start' ? yield* opened(git, ask.query) : histories.get(ask.job);
  if (held === undefined) return yield* new Unread({ cause: 'source', reason: 'the inspection worker no longer holds this history' });
  const entries = held.entries.slice(held.at, held.at + PAGE);
  held.at += entries.length;
  const done = held.at === held.entries.length;
  if (done) histories.delete(ask.job);
  else histories.set(ask.job, held);
  return { worked: { history: { entries, done } satisfies HistoryPage }, read: [] };
});
