export class TerminalAuthority {
  private refused = $state<{ readonly threadId: string; readonly reason: string } | null>(null);

  refusalOf(threadId: string | null): string | null {
    return threadId !== null && this.refused?.threadId === threadId ? this.refused.reason : null;
  }

  settle(): void {
    this.refused = null;
  }

  refuse(threadId: string, reason: string): void {
    this.refused = { threadId, reason };
  }
}
