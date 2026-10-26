export interface SlotWriter {
  navigate(threadId: string | null): void;
  open(threadId: string): void;
}

export interface SlotContext {
  scopeName(): string | null;
}

export class SlotSelection {
  private chosen = $state<string | null>(null);
  private generations = 0;

  constructor(
    private readonly projectId: number,
    private readonly newKey: string = `new:${projectId}`,
  ) {}

  get activeId(): string | null {
    return this.chosen;
  }

  get generation(): number {
    return this.generations;
  }

  select(threadId: string | null): void {
    this.chosen = threadId;
    this.generations += 1;
  }

  draftKey(threadId: string | null): string {
    return threadId === null ? this.newKey : `thread:${threadId}`;
  }
}
