import type { ChatFold } from '@runlith/chat-ui/ChatFold.svelte';
import type { ThreadSessionStatus } from '@runlith/chat-ui/session/ThreadSession.svelte';
import { Service } from '@runlith/layer/key';

export type TranscriptSeat = {
  readonly fold: ChatFold;
  readonly status: ThreadSessionStatus;
  readonly problem: string | null;
  older(): Promise<boolean>;
  release(): void;
};

export interface TranscriptPort {
  take(projectId: number, threadId: string): TranscriptSeat;
}

export class ThreadTranscripts extends Service<TranscriptPort>()('ThreadTranscripts', { tier: 'app' }) {}
