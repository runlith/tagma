import { Effect } from 'effect';
import type { SearchHit } from '@tagma/server/graph/contract/wire/reads';
import { type ComposerHandler, type ComposerMentionOption, ComposerRefused } from '@runlith/chat-ui/composer';
import type { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import type { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import type { ThreadDraft } from '../Draft.svelte.js';
import { refused } from '../notices.js';

export class ComposerFeeds {
  private rows = $state.raw<readonly SearchHit[]>([]);
  private close = $state(false);
  private asked = 0;

  constructor(
    private readonly draft: ThreadDraft,
    private readonly selection: ReturnType<typeof SelectionRepo.use>,
    private readonly tags: TagCatalog,
    private readonly projectId: number,
    private readonly dismiss: () => void,
  ) {}

  mentions = $derived<readonly ComposerMentionOption[]>(this.rows.map((row) => this.option(row)));

  get label(): string | undefined {
    return this.close && this.rows.length > 0 ? 'No exact match, close spellings' : undefined;
  }

  search(query: string): ComposerHandler {
    return Effect.suspend(() => {
      const sequence = ++this.asked;
      return Effect.tryPromise({
        try: async () => {
          try {
            const page = await this.selection.search.key({ query, projectId: this.projectId }).loadOrThrow();
            if (sequence === this.asked && page) {
              this.rows = page.items;
              this.close = page.approximate;
            }
          } catch (error) {
            if (sequence === this.asked) throw error;
          }
        },
        catch: refused,
      });
    });
  }

  tagOf(optionId: string): string | null {
    const row = this.rows.find((one) => one.name === optionId);
    return row === undefined ? null : this.tags.tagOf(row);
  }

  pick(name: string): ComposerHandler {
    return Effect.sync(() => {
      const row = this.rows.find((item) => item.name === name);
      if (row) this.draft.stageMentions([{ name: row.name, title: row.title, tag: this.tags.tagOf(row) }]);
    });
  }

  attach(files: readonly File[]): ComposerHandler {
    return Effect.flatMap(Effect.tryPromise({ try: () => this.draft.attach(files), catch: refused }), (result): ComposerHandler => {
      if (result.notice) return Effect.fail(new ComposerRefused({ message: result.notice }));
      if (result.added > 0) this.dismiss();
      return Effect.void;
    });
  }

  private option(block: SearchHit): ComposerMentionOption {
    const status = this.tags.statusOf(block);
    return {
      id: block.name,
      label: block.title.trim() || block.name,
      description: `${block.name} · ${this.tags.word(this.tags.tagOf(block))}${status === null ? '' : `/${status}`}`,
    };
  }
}
