import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ThreadContextReading, ThreadModes } from '@runlith/chat-ui/wire/ChatConnection';
import { approvalModes } from './modeWords.js';

export function declared<S extends { readonly thread: WireThread }>(
  snapshot: S,
): S & { readonly modes: ThreadModes; readonly contextReading: ThreadContextReading } {
  return {
    ...snapshot,
    modes: approvalModes(snapshot.thread.modes, snapshot.thread.authority.mode),
    contextReading: snapshot.thread.contextReading,
  };
}
