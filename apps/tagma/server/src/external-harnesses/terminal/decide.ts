import type { RunEnding } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';

export const READ_DEADLINE_MS = 10 * 60_000;

export const QUIET_WINDOW_MS = 60_000;

export const PLAIN_BEAT_MS = 2_000;

export const COMPACTION_BEAT_MS = 1_000;

export type Unread = NonNullable<ExternalSession['unread']>[number];

export type WatchEvidence = {
  readonly now: number;
  readonly seen: ReadonlySet<string>;
  readonly seenInTurn: ReadonlySet<string>;
  readonly ending: RunEnding | null;
  readonly message: string | null;
  readonly endedRun: string | null;
  readonly settling: boolean;
  readonly asking: boolean;
  readonly absent: boolean;
  readonly idle: PromptIdle | null;
};

export type PromptIdle = { readonly movedAt: string | undefined };

export type WatchVerdict = {
  readonly read: readonly { readonly run: string; readonly items: readonly string[] }[];
  readonly lapsed: readonly { readonly run: string; readonly items: readonly string[] }[];
  readonly end: { readonly run: string; readonly spoke: number; readonly ending: RunEnding; readonly message: string | null } | null;
  readonly unread: readonly Unread[];
};

const readerOf = (facet: ExternalSession, evidence: WatchEvidence, entry: Unread, id: string): string | null => {
  const turn = facet.turn;
  if (turn === undefined) return evidence.settling ? entry.run : null;
  if (turn.run === entry.run) return entry.run;
  if (evidence.seenInTurn.has(id)) return turn.run;
  return turn.offset === null ? null : entry.run;
};

export function decideWatch(facet: ExternalSession, evidence: WatchEvidence): WatchVerdict {
  const turn = facet.turn;
  const unopened = evidence.ending === null && evidence.absent && untaken(facet, evidence.now);
  const idled = evidence.ending === null && evidence.idle !== null && turn !== undefined && turn.movedAt === evidence.idle.movedAt;
  const ending: RunEnding | null = unopened || idled ? { kind: 'aborted', stoppedBy: 'reader' } : evidence.ending;
  const blocked =
    turn !== undefined && (facet.unread ?? []).some((entry) => entry.run === turn.run && entry.items.some((id) => !evidence.seen.has(id)));
  const closing = ending !== null && turn !== undefined && turn.run === evidence.endedRun && (unopened || !blocked);
  const read = new Map<string, string[]>();
  const lapsed: { run: string; items: string[] }[] = [];
  const unread: Unread[] = [];
  for (const entry of facet.unread ?? []) {
    const kept: string[] = [];
    const expired: string[] = [];
    const late =
      entry.send !== 'intended' &&
      !evidence.asking &&
      (evidence.now - Date.parse(entry.at) >= READ_DEADLINE_MS || (unopened && entry.run === turn?.run));
    for (const id of entry.items) {
      if (evidence.seen.has(id)) {
        const reader = readerOf(facet, evidence, entry, id);
        if (reader === null) kept.push(id);
        else read.set(reader, [...(read.get(reader) ?? []), id]);
      } else if (late) expired.push(id);
      else kept.push(id);
    }
    if (expired.length > 0) lapsed.push({ run: entry.run, items: expired });
    if (kept.length > 0) unread.push({ ...entry, items: kept });
  }
  return {
    read: [...read].map(([run, items]) => ({ run, items })),
    lapsed,
    end:
      closing && turn !== undefined && ending !== null
        ? { run: turn.run, spoke: turn.spoke ?? 0, ending, message: unopened ? null : evidence.message }
        : null,
    unread,
  };
}

export function untaken(facet: ExternalSession, now: number): boolean {
  const { turn, session, observation } = facet;
  if (turn === undefined || turn.turn !== null) return false;
  if (session === undefined || observation.binding.sessionId !== session.id || observation.through === undefined) return false;
  const moved = Math.max(Date.parse(observation.through), Date.parse(turn.movedAt ?? turn.openedAt));
  return now - moved >= QUIET_WINDOW_MS;
}

export const PROMPT_READS = 3;

export const PROMPT_BEAT_MS = 2_000;

export type PromptSample = { readonly shown: boolean; readonly movedAt: string | undefined };

export function promptStep(seen: readonly PromptSample[], sample: PromptSample): 'again' | 'confirmed' | 'broken' {
  if (!sample.shown) return 'broken';
  if (seen.some((each) => each.movedAt !== sample.movedAt)) return 'broken';
  return seen.length + 1 >= PROMPT_READS ? 'confirmed' : 'again';
}
