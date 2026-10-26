import { Service } from '@runlith/layer/key';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';

export class JournalLive extends Service<JournalLive>()('JournalLive', { tier: 'graph' }) {
  static *make() {
    return new JournalLive(yield* GraphRung.Current, yield* ReaderMarks);
  }

  constructor(
    private readonly aim: GraphAim,
    private readonly marks: ReaderMarks,
  ) {
    super();
  }

  get seenId(): number {
    return this.marks.journal.get(this.key) ?? 0;
  }

  markSeen(eventId: number): void {
    if (eventId <= this.seenId) return;
    this.marks.journal.set(this.key, eventId);
  }

  private get key(): string {
    return `${this.aim.projectId}:${this.aim.branch ?? ''}`;
  }
}
