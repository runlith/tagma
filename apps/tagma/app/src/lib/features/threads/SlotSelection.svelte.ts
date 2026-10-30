export interface SlotWriter {
  navigate(threadId: string | null): void;
  open(threadId: string): void;
  rehome(projectId: number): void;
}

export interface SlotContext {
  scopeName(): string | null;
}

export function unbornKey(projectId: number, pane: string | null = null): string {
  return pane === null ? `new:${projectId}` : `new:${projectId}:${pane}`;
}

export class SlotSelection {
  private chosen = $state<string | null>(null);
  private generations = 0;

  private readonly newKey: string;

  constructor(
    projectId: number,
    private readonly pane: string | null = null,
  ) {
    this.newKey = unbornKey(projectId, pane);
  }

  draftKeyIn(projectId: number): string {
    return unbornKey(projectId, this.pane);
  }

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
