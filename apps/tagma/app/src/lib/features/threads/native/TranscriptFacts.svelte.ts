import { tokensLabel } from '@tagma/server/threads/voice/threadText';
import type { ChatFold } from '@runlith/chat-ui/ChatFold.svelte';
import type { ChatEntry } from '@runlith/chat-ui/entries';
import type { ChatMessageMetaExtra } from '@runlith/chat-ui/renderers';
import { sharedPrefix } from '@runlith/utils/collection';
import { terminalKey } from '$lib/features/executions/Repo.js';
import { productPayload } from '@runlith/chat-ui/entries';
import { compositionRest, type ThreadCompositionEntry } from '@runlith/agent/transcript/entries';
import { compositionId } from './productRecords.js';
import { launchedCommand } from '../activityIdentity.js';

type Priced = { readonly source: ChatEntry; readonly extra: ChatMessageMetaExtra | null };

class Tally {
  private entries: readonly ChatEntry[] = [];
  private readonly marks: (readonly string[])[] = [];

  constructor(
    private readonly counts: Map<string, number>,
    private readonly read: (entry: ChatEntry) => readonly string[],
  ) {}

  next(entries: readonly ChatEntry[]): boolean {
    const from = sharedPrefix(this.entries, entries);
    let moved = false;
    while (this.marks.length > from) {
      for (const key of this.marks.pop()!) {
        const count = (this.counts.get(key) ?? 0) - 1;
        if (count > 0) this.counts.set(key, count);
        else moved = this.counts.delete(key) || moved;
      }
    }
    for (let at = from; at < entries.length; at += 1) {
      const keys = this.read(entries[at]!);
      this.marks.push(keys);
      for (const key of keys) {
        const count = this.counts.get(key) ?? 0;
        this.counts.set(key, count + 1);
        moved = moved || count === 0;
      }
    }
    this.entries = entries;
    return moved;
  }
}

export class TranscriptFacts {
  private readonly launchCounts = new Map<string, number>();
  private readonly launchTally = new Tally(this.launchCounts, (entry) => {
    const launched = launchedCommand(entry);
    const title = entry.kind === 'tool' ? entry.display?.title : undefined;
    return launched === null || title === undefined ? [] : [`${terminalKey(launched)}\n${title}`];
  });
  private launchMap: ReadonlyMap<string, string> = new Map();
  private priced = new Map<string, Priced>();

  constructor(private readonly fold: () => ChatFold) {}

  launches = $derived.by(() => {
    if (!this.launchTally.next(this.fold().index.of('tool'))) return this.launchMap;
    this.launchMap = new Map(
      [...this.launchCounts.keys()].map((mark) => {
        const cut = mark.indexOf('\n');
        return [mark.slice(0, cut), mark.slice(cut + 1)] as const;
      }),
    );
    return this.launchMap;
  });

  private compositions = $derived.by(() => {
    const priced = new Map<string, Priced>();
    for (const entry of this.fold().index.of('product')) {
      const composition = productPayload(compositionId, entry);
      if (composition === undefined || entry.runId === undefined || priced.has(entry.runId)) continue;
      const held = this.priced.get(entry.runId);
      priced.set(entry.runId, held?.source === entry ? held : { source: entry, extra: compositionMeta(composition) });
    }
    this.priced = priced;
    return priced;
  });

  meta(entry: ChatEntry): ChatMessageMetaExtra | null {
    if (entry.kind !== 'assistant' || entry.runId === undefined) return null;
    const at = this.fold().at(entry.id);
    if (at === undefined || !this.fold().index.closesRun('assistant', at, entry.runId)) return null;
    return this.compositions.get(entry.runId)?.extra ?? null;
  }
}

function compositionMeta(data: ThreadCompositionEntry | undefined): ChatMessageMetaExtra | null {
  const tokens = data?.tokens;
  if (!data || !tokens) return null;
  const rest = compositionRest(tokens);
  return {
    text: tokensLabel(tokens.total, false),
    rows: [
      { label: 'system', value: tokensLabel(tokens.system, true) },
      ...(tokens.context === null ? [] : [{ label: 'context', value: tokensLabel(tokens.context, true) }]),
      { label: `tools · ${tokens.each.length}`, value: tokensLabel(tokens.tools, true) },
      ...(rest === 0 ? [] : [{ label: 'history and agent prompt', value: tokensLabel(rest, true) }]),
      ...(data.tools.count > tokens.each.length
        ? [{ label: `deferred · ${data.tools.count - tokens.each.length}`, value: 'names only' }]
        : []),
      ...[...tokens.each]
        .sort((a, b) => b.tokens - a.tokens)
        .map((tool) => ({ label: `· ${tool.name}`, value: tokensLabel(tool.tokens, true) })),
    ],
  };
}
