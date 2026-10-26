import { Effect } from 'effect';
import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ChatHold } from '../../ChatHold.svelte.js';
import type { ModelPanelState } from '../../ModelPanelState.svelte.js';
import type { ShownThread } from '../../ShownThread.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import { ThreadCompaction } from '../../thread/ThreadCompaction.svelte.js';
import type { CommandDeclaration } from '../contribution.js';

export function compactCommand(shown: ShownThread, chat: ChatHold, writes: ThreadWrites, panel: ModelPanelState): ComposerSlashCommand {
  return {
    name: 'compact',
    order: 70,
    get description() {
      return chat.commands.runId ? 'Compact at the next step' : 'Compact this thread';
    },
    get keyHint() {
      return chat.commands.runId ? { chord: { code: 'Tab' }, words: 'after this run and what waits' } : undefined;
    },
    get value() {
      return shown.lease?.find(ThreadCompaction)?.resolvedWords(Date.now());
    },
    get valueActive() {
      return shown.lease?.find(ThreadCompaction)?.choices?.resolved.kind === 'none';
    },
    get disabled() {
      return !shown.id;
    },
    opens: true,
    run: ({ query }) =>
      shown.row?.capabilities.compaction === 'none'
        ? writes.compaction('end', null)
        : Effect.sync(() => panel.open('compact', query ?? '')),
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'compact', make: (owners) => compactCommand(owners.shown, owners.chat, owners.writes, owners.panel) },
];
