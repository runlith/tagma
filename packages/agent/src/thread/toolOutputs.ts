import type { Effect } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import type { AgentToolOutputs } from '../agent/ToolOutput';
import type { ToolCatalog } from '../agent/ToolCatalog';
import type { ThreadInterruptedInput } from '../transcript/entries';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import type { ThreadPortFailure } from './ThreadBorder';

export type ThreadToolOutputContext = {
  readonly threadId: string;
  readonly ownerId: string;
  readonly runId: string | null;
};

export type ThreadOpenInputHold = {
  readonly input: ThreadInterruptedInput;
  readonly chars: number;
};

export type ThreadToolOutputScope<TWrite> = Omit<AgentToolOutputs, 'keepPicture'> & {
  readonly tools: ToolCatalog;
  retainInterrupted(input: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly text: string;
    readonly complete: boolean;
  }): Effect.Effect<ThreadInterruptedInput, ThreadPortFailure>;
  retainOpen(input: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly text: string;
    readonly held: ThreadOpenInputHold | null;
  }): Effect.Effect<ThreadOpenInputHold, ThreadPortFailure>;
  commitReferenced(
    messages: readonly Message[],
    entries: readonly ThreadTranscriptEntry[],
    tx: TWrite,
  ): Effect.Effect<void, ThreadPortFailure>;
  dispose(): Effect.Effect<void, ThreadPortFailure>;
};

export interface ThreadToolOutputStorage<TWrite> {
  scope(input: ThreadToolOutputContext): ThreadToolOutputScope<TWrite>;
  settleOpen(threadId: string, inputs: readonly ThreadInterruptedInput[]): Effect.Effect<void, ThreadPortFailure>;
}
