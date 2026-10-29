import { Service } from '@runlith/layer/key';
import { GraphRung, type GraphAim } from '$lib/features/workspace/GraphRung.js';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';

const TRAIL_DEPTH = 8;

export class ReadState extends Service<ReadState>()('ReadState', { tier: 'graph' }) {
  static *make() {
    return new ReadState(yield* GraphRung.Current, yield* ReaderMarks);
  }

  constructor(
    private readonly aim: GraphAim,
    private readonly marks: ReaderMarks,
  ) {
    super();
  }

  private key(name: string): string {
    return `${this.aim.branch ?? ''}\t${name}`;
  }

  markRead(name: string, updatedAt: string): void {
    const mark = this.marks.seen.get(this.key(name));
    if (mark !== undefined && mark >= updatedAt) return;
    this.marks.seen.set(this.key(name), updatedAt);
  }

  isUnread(name: string, updatedAt: string): boolean {
    const mark = this.marks.seen.get(this.key(name));
    return mark === undefined || mark < updatedAt;
  }

  seenAt(name: string): string | undefined {
    return this.marks.seen.get(this.key(name));
  }

  visited(name: string): void {
    const kept = this.trailOf;
    if (kept[0] === name) return;
    this.marks.trail.set(this.project, [name, ...kept.filter((other) => other !== name)].slice(0, TRAIL_DEPTH));
  }

  get trailOf(): readonly string[] {
    return this.marks.trail.get(this.project) ?? [];
  }

  private get project(): string {
    return String(this.aim.projectId);
  }
}
