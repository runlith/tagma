import { compositionRest } from '@runlith/agent/transcript/entries';
import type { ChatContextAttribution, ChatContextSource } from '@runlith/chat-ui/contextUsage';
import { productPayload } from '@runlith/chat-ui/entries';
import { Service } from '@runlith/layer/key';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { compositionId } from '../native/productRecords.js';
import { contextLabelsOf, type ContextLabels } from './modelSettings.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { ThreadSettings } from './ThreadSettings.svelte.js';

export class ThreadContext extends Service<ThreadContext>()('ThreadContext', { tier: 'thread' }) {
  static *make() {
    return new ThreadContext(yield* ThreadFeed, yield* ThreadSettings, yield* ProviderCatalog);
  }

  constructor(
    private readonly feed: ThreadFeed,
    private readonly settings: ThreadSettings,
    private readonly catalog: ProviderCatalog,
  ) {
    super();
  }

  labels(source: ChatContextSource): ContextLabels | null {
    return contextLabelsOf(this.catalog.models, source, this.settings.settings);
  }

  attribution = $derived.by<ChatContextAttribution | undefined>(() => {
    const priced = this.feed.session.fold.index.of('product').findLast((entry) => productPayload(compositionId, entry) !== undefined);
    const tokens = priced === undefined ? undefined : productPayload(compositionId, priced)?.tokens;
    if (!tokens) return undefined;
    return {
      slices: [
        { label: 'System prompt', tokens: tokens.system },
        { label: 'Tools', tokens: tokens.tools },
        ...(tokens.context === null ? [] : [{ label: 'Orientation', tokens: tokens.context }]),
        { label: 'History and agent prompt', tokens: compositionRest(tokens) },
      ],
      remainderLabel: 'Conversation',
    };
  });
}
