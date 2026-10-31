import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ChatHold } from '../../ChatHold.svelte.js';
import type { ShownThread } from '../../ShownThread.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import { ThreadFeed } from '../../thread/ThreadFeed.svelte.js';
import { ThreadRecap } from '../../thread/ThreadRecap.svelte.js';
import { warmthAt } from '../../warmthWords.js';
import type { CommandDeclaration } from '../contribution.js';

function writing(shown: ShownThread): boolean {
  return shown.lease?.get(ThreadRecap).busy ?? false;
}

function cache(shown: ShownThread): string | undefined {
  const warmth = shown.lease?.get(ThreadFeed).chatThread?.cacheWarmth ?? null;
  const state = warmth === null ? 'unknown' : warmthAt(warmth, () => Date.now());
  return state === 'cold' ? 'Cache cold' : state === 'unknown' ? 'Cache state unknown' : undefined;
}

function recapCommand(shown: ShownThread, chat: ChatHold, writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'recap',
    order: 90,
    description: 'Write a summary of this thread now',
    get value() {
      return writing(shown) ? 'Writing' : cache(shown);
    },
    get disabled() {
      return !shown.id || writing(shown) || (chat.session?.activeRunId ?? null) !== null || chat.target.fold.entries.length === 0;
    },
    run: () => writes.writeRecap(),
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'recap', make: (owners) => recapCommand(owners.shown, owners.chat, owners.writes) },
];
