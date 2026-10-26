export type PromptHistoryEntry = {
  readonly text: string;
  readonly at: number;
};

export type PromptHistoryStore = {
  read(): readonly PromptHistoryEntry[];
  write(entries: readonly PromptHistoryEntry[]): void;
};

export const PROMPT_HISTORY_MAX = 100;

export class PromptHistory {
  private entries: readonly PromptHistoryEntry[] = [];
  private browsing: number | null = null;
  private stashed = '';

  constructor(private readonly store: PromptHistoryStore) {}

  get index(): number | null {
    return this.browsing;
  }

  previous(draft: string): string | null {
    if (this.browsing === null) {
      const entries = this.store.read();
      if (entries.length === 0) return null;
      this.entries = entries;
      this.stashed = draft;
      this.browsing = 0;
      return entries[0]!.text;
    }
    this.browsing = Math.min(this.browsing + 1, this.entries.length - 1);
    return this.entries[this.browsing]!.text;
  }

  next(): string | null {
    if (this.browsing === null) return null;
    if (this.browsing === 0) return this.leave();
    this.browsing -= 1;
    return this.entries[this.browsing]!.text;
  }

  leave(): string | null {
    if (this.browsing === null) return null;
    this.browsing = null;
    const stashed = this.stashed;
    this.stashed = '';
    return stashed;
  }

  edited(): void {
    this.browsing = null;
    this.stashed = '';
  }

  record(text: string): void {
    const words = text.trim();
    if (words === '') return;
    const entries = this.store.read();
    if (entries[0]?.text === words) return;
    this.store.write([{ text: words, at: Date.now() }, ...entries].slice(0, PROMPT_HISTORY_MAX));
  }
}

export type PromptRecall = Pick<PromptHistory, 'index' | 'previous' | 'next' | 'leave' | 'edited'>;
