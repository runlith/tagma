import type {
  AgentCallEnding,
  AgentChildUpdate,
  AgentCommandEnding,
  AgentSignalNotice,
  AgentThreadEvent,
  AgentThreadRef,
} from '@runlith/agent/contracts';
import type { ChatEntry } from './entries';
import type { ChatActivityIdentity } from './renderers';
import type { ChatStrings } from './strings';

export type NoticeEntry = Extract<ChatEntry, { kind: 'signal' }> & { readonly notice: AgentSignalNotice };

export type ChildUpdateCount = { readonly event: AgentChildUpdate['event']; readonly count: number };

export type CallEndingCount = { readonly tool: string; readonly outcome: AgentCallEnding['outcome']; readonly count: number };

export type CommandEndingCount = { readonly ending: AgentCommandEnding['ending']; readonly count: number };

export type ThreadEventCount = { readonly event: AgentThreadEvent['event']; readonly count: number };

export type NoticeThread = ChatActivityIdentity['threads'][number];

type ThreadName = ((threadId: string, projectId?: number) => string | null) | undefined;

export function noticeEntry(entry: ChatEntry): entry is NoticeEntry {
  return entry.kind === 'signal' && entry.notice !== undefined;
}

export function sameNotice(one: AgentSignalNotice, other: AgentSignalNotice): boolean {
  return one.kind === other.kind;
}

function counted<K>(keys: readonly K[], keyOf: (key: K) => string, threads: (key: K) => readonly string[]): readonly [K, number][] {
  const held = new Map<string, [K, Set<string>]>();
  for (const key of keys) {
    const at = keyOf(key);
    const standing = held.get(at);
    if (standing === undefined) held.set(at, [key, new Set(threads(key))]);
    else for (const thread of threads(key)) standing[1].add(thread);
  }
  return [...held.values()].map(([key, seen]) => [key, seen.size]);
}

export function noticeLead(notices: readonly AgentSignalNotice[], strings: ChatStrings): readonly string[] {
  const children = notices.flatMap((notice) => (notice.kind === 'child-update' ? [notice] : []));
  const calls = notices.flatMap((notice) => (notice.kind === 'call-ending' ? [notice] : []));
  const commands = notices.flatMap((notice) => (notice.kind === 'command-ending' ? [notice] : []));
  const events = notices.flatMap((notice) => (notice.kind === 'thread-event' ? [notice] : []));
  const parts: string[] = [];
  if (children.length > 0) {
    const counts = counted(
      children,
      (notice) => notice.event,
      (notice) => [notice.child.threadId],
    );
    parts.push(strings.childUpdates(counts.map(([notice, count]) => ({ event: notice.event, count }))));
  }
  if (calls.length > 0) {
    const counts = counted(
      calls,
      (notice) => `${notice.tool}\n${notice.outcome}`,
      (notice) => [`${notice.runId}\n${notice.toolCallId}`],
    );
    parts.push(strings.callEndings(counts.map(([notice, count]) => ({ tool: notice.tool, outcome: notice.outcome, count }))));
  }
  if (commands.length > 0) {
    const counts = counted(
      commands,
      (notice) => notice.ending,
      (notice) => [`${notice.execution}:${notice.incarnation}`],
    );
    parts.push(strings.commandEndings(counts.map(([notice, count]) => ({ ending: notice.ending, count }))));
  }
  if (events.length > 0) {
    const counts = counted(
      events,
      (notice) => notice.event,
      (notice) => [notice.thread.threadId],
    );
    parts.push(strings.threadEvents(counts.map(([notice, count]) => ({ event: notice.event, count }))));
  }
  return parts;
}

export function noticeThread(thread: AgentThreadRef, threadName: ThreadName): NoticeThread {
  const title = threadName?.(thread.threadId, thread.projectId) ?? thread.name ?? thread.threadId;
  return thread.projectId === undefined ? { id: thread.threadId, title } : { id: thread.threadId, title, projectId: thread.projectId };
}

function noticeRefs(notice: AgentSignalNotice): readonly AgentThreadRef[] {
  switch (notice.kind) {
    case 'child-update':
      return [notice.child];
    case 'thread-event':
      return [notice.thread];
    case 'call-ending':
      return notice.threads;
    case 'command-ending':
      return [];
  }
}

export function noticeThreads(notices: readonly AgentSignalNotice[], threadName: ThreadName): readonly NoticeThread[] {
  const seen = new Set<string>();
  return notices
    .flatMap((notice) => noticeRefs(notice))
    .filter((thread) => !seen.has(thread.threadId) && seen.add(thread.threadId))
    .map((thread) => noticeThread(thread, threadName));
}

export function warmShare(update: AgentChildUpdate, at: string | undefined, now: number): number | null {
  if (update.cost.kind !== 'warm') return null;
  const until = Date.parse(update.cost.until);
  const from = at === undefined ? Number.NaN : Date.parse(at);
  if (now >= until) return 0;
  return Number.isFinite(from) && until > from ? Math.min(1, (until - now) / (until - from)) : 1;
}
