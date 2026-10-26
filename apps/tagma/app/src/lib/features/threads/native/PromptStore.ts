import type { PromptHistoryEntry, PromptHistoryStore } from '@runlith/chat-ui/PromptHistory';
import type { PlatformStorage } from '@runlith/layer/Platform';

const PROMPTS_KEY = 'tagma.prompts.';

export class PromptStore implements PromptHistoryStore {
  constructor(
    private readonly storage: PlatformStorage,
    private readonly projectId: number,
  ) {}

  read(): readonly PromptHistoryEntry[] {
    const raw = this.storage.getItem(this.key());
    if (raw === null) return [];
    try {
      return entriesOf(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  write(entries: readonly PromptHistoryEntry[]): void {
    this.storage.setItem(this.key(), JSON.stringify(entries));
  }

  private key(): string {
    return `${PROMPTS_KEY}${this.projectId}`;
  }
}

function entriesOf(value: unknown): readonly PromptHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.text !== 'string') return [];
    return [{ text: row.text, at: typeof row.at === 'number' ? row.at : 0 }];
  });
}
