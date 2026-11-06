import type { Point } from '@runlith/layer/Point';
import type { TranscriptPort, TranscriptSeat } from '$lib/features/plugin-views/ThreadTranscripts.js';
import type { Door } from '$lib/wire/Door.js';
import type { ProductRecord } from './native/records.js';
import { chatHandlers, type ThreadChats } from './ThreadChats.js';

export class ChatTranscripts implements TranscriptPort {
  constructor(
    private readonly chats: ThreadChats,
    private readonly door: Door,
    private readonly records: Point<ProductRecord>,
  ) {}

  take(projectId: number, threadId: string): TranscriptSeat {
    const hold = this.chats.hold(projectId, threadId, chatHandlers(this.door, projectId, this.records));
    const session = hold.session;
    return {
      fold: session.fold,
      get status() {
        return session.status;
      },
      get problem() {
        return session.errors.at(-1) ?? null;
      },
      older: hold.older,
      release: () => void hold.release(),
    };
  }
}
