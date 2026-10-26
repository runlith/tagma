type Opening = Map<string, boolean>;

export class ThreadAudience {
  private readonly families = new Map<number, Set<string>>();
  private readonly recipients = new Map<string, Set<number>>();
  private readonly openings = new Map<number, Set<Opening>>();
  private readonly nobody: ReadonlySet<number> = new Set();

  watch(projectId: number): void {
    if (!this.families.has(projectId)) this.families.set(projectId, new Set());
  }

  projects(threadId: string): ReadonlySet<number> {
    return this.recipients.get(threadId) ?? this.nobody;
  }

  has(threadId: string): boolean {
    return this.recipients.has(threadId);
  }

  include(projectId: number, ids: Iterable<string>): void {
    for (const id of ids) this.change(projectId, id, true);
  }

  remove(projectId: number, id: string): void {
    this.change(projectId, id, false);
  }

  close(projectId: number): readonly string[] {
    const prior = [...(this.families.get(projectId) ?? [])];
    for (const id of prior) this.change(projectId, id, false, false);
    this.families.delete(projectId);
    this.openings.delete(projectId);
    return prior.filter((id) => !this.has(id));
  }

  opening(projectId: number, replace: boolean) {
    const family = this.families.get(projectId);
    const moves: Opening = new Map();
    const waiting = this.openings.get(projectId) ?? new Set<Opening>();
    waiting.add(moves);
    this.openings.set(projectId, waiting);
    const close = () => {
      waiting.delete(moves);
      if (waiting.size === 0 && this.openings.get(projectId) === waiting) this.openings.delete(projectId);
    };
    return {
      install: (ids: Iterable<string>) => {
        if (family === undefined || this.families.get(projectId) !== family) return [];
        const prior = [...family];
        if (replace) for (const id of this.families.get(projectId) ?? []) this.change(projectId, id, false, false);
        for (const id of ids) this.change(projectId, id, true, false);
        for (const [id, present] of moves) this.change(projectId, id, present, false);
        return prior.filter((id) => !this.has(id));
      },
      close,
    };
  }

  private change(projectId: number, id: string, present: boolean, record = true): void {
    const family = this.families.get(projectId);
    if (family === undefined) return;
    if (record) for (const opening of this.openings.get(projectId) ?? []) opening.set(id, present);
    if (present) {
      family.add(id);
      const recipients = this.recipients.get(id) ?? new Set<number>();
      recipients.add(projectId);
      this.recipients.set(id, recipients);
    } else {
      family.delete(id);
      const recipients = this.recipients.get(id);
      recipients?.delete(projectId);
      if (recipients?.size === 0) this.recipients.delete(id);
    }
  }
}
