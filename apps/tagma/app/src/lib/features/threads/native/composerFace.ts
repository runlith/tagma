import type { PromptHandle } from '@runlith/chat-ui/PromptHandle.svelte';
import { TagmaRefused } from '@runlith/tagma/plugin';
import type { ComposerFace } from '../../plugin-views/composer.js';
import type { ChatHold } from '../ChatHold.svelte.js';
import type { HeldDraft, ThreadDraft } from '../Draft.svelte.js';
import type { ShownThread } from '../ShownThread.js';
import type { ThreadWrites } from '../ThreadWrites.js';

const OPERATION = 'composer';

export function composerFace(
  shown: ShownThread,
  held: HeldDraft,
  draft: ThreadDraft,
  chat: ChatHold,
  writes: ThreadWrites,
  prompt: PromptHandle,
): ComposerFace {
  const id = shown.id;
  const projectId = shown.projectId;
  return {
    thread: {
      id,
      projectId,
      get life() {
        return held.current ? (chat.session?.life ?? null) : null;
      },
    },
    draft: {
      get text() {
        return held.text;
      },
      setText: (text) => held.setText(text),
      insert: (text) => {
        if (!held.current || !prompt.insert(text)) held.setText(held.text + text);
      },
      attach: async (files) => {
        if (!held.current) throw new TagmaRefused(OPERATION, 'thread-moved', 'The composer shows another thread now.', []);
        const { notice } = await draft.attach(files);
        if (notice === undefined) return;
        chat.commands.say({ tone: 'error', message: notice });
        throw new TagmaRefused(OPERATION, 'attachment-refused', notice, []);
      },
    },
    send: () => (held.current ? writes.send() : Promise.resolve(false)),
  };
}
