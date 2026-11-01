import type { ThreadLiveEvent } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadOpenChange, ThreadOpenView } from '@runlith/agent/transcript/live';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { NativeThreadState } from '../contract/service/state.js';
import type { PresenceTail, PresenceTailStep } from '../contract/wire/presence.js';
import { cutHead } from '../contract/wire/tail.js';

export const TAIL_CODE_POINTS = 280;

function suffixStart(text: string, codePoints: number): number {
  let at = text.length;
  for (let left = codePoints; left > 0 && at > 0; left -= 1) {
    const low = text.charCodeAt(at - 1);
    const high = at >= 2 ? text.charCodeAt(at - 2) : 0;
    at -= low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? 2 : 1;
  }
  return at;
}

function codePointCount(text: string): number {
  let count = 0;
  for (let at = 0; at < text.length; at += text.codePointAt(at)! > 0xffff ? 2 : 1) count += 1;
  return count;
}

function reasoningOf(entry: ThreadTranscriptEntry): { readonly runId: string; readonly id: string; readonly text: string } | null {
  if (entry.type !== 'reasoning') return null;
  const { runId, text } = entry as { readonly runId?: unknown; readonly text?: unknown };
  return typeof runId === 'string' && typeof text === 'string' ? { runId, id: entry.id, text } : null;
}

export type TailMove = PresenceTailStep | null | undefined;

export class ReasoningTail {
  private held: PresenceTail | null = null;

  constructor(private readonly view: () => ThreadOpenView) {}

  get current(): PresenceTail | null {
    return this.held;
  }

  seed(): void {
    this.held = null;
    const open = this.view().open;
    for (let at = open.length - 1; at >= 0; at -= 1) {
      const reasoning = reasoningOf(open[at]!.entry);
      if (reasoning === null) continue;
      this.held = {
        runId: reasoning.runId,
        entryId: reasoning.id,
        text: reasoning.text.slice(suffixStart(reasoning.text, TAIL_CODE_POINTS)),
      };
      return;
    }
  }

  apply(event: ThreadLiveEvent<NativeThreadState>): TailMove {
    if (event.type === 'open') return this.change(event.change);
    const held = this.held;
    return held !== null && !this.view().open.some((one) => one.entry.id === held.entryId) ? this.clear() : undefined;
  }

  private change(change: ThreadOpenChange): TailMove {
    switch (change.op) {
      case 'put': {
        const reasoning = reasoningOf(change.entry);
        if (reasoning === null) return undefined;
        const text = reasoning.text.slice(suffixStart(reasoning.text, TAIL_CODE_POINTS));
        const held = this.held;
        if (held?.runId === reasoning.runId && held.entryId === reasoning.id && held.text === text) return undefined;
        this.held = { runId: reasoning.runId, entryId: reasoning.id, text };
        return { restart: true, ...this.held };
      }
      case 'append': {
        const held = this.held;
        if (held === null || held.entryId !== change.id) return undefined;
        const start = suffixStart(change.text, TAIL_CODE_POINTS);
        if (start > 0) {
          this.held = { ...held, text: change.text.slice(start) };
          return { restart: true, ...this.held };
        }
        const joined = held.text + change.text;
        const drop = Math.max(0, codePointCount(joined) - TAIL_CODE_POINTS);
        this.held = { ...held, text: cutHead(joined, drop) };
        return { restart: false, text: change.text, drop };
      }
      case 'drop':
        return this.held?.entryId === change.id ? this.clear() : undefined;
      case 'progress':
        return undefined;
    }
  }

  private clear(): null {
    this.held = null;
    return null;
  }
}
