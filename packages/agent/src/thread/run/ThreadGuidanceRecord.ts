import type { AgentRuntimeGuidance } from '../../agent/contracts';
import type { ThreadTranscript } from '../../transcript/rows';

export class ThreadGuidanceRecord {
  private readonly seen = new Map<string, number>();
  private frames: AgentRuntimeGuidance[] = [];

  constructor(runEntries: ThreadTranscript) {
    for (const entry of runEntries) {
      if (entry.type !== 'runtime-guidance') continue;
      const frame = entry as AgentRuntimeGuidance;
      this.seen.set(guidanceKey(frame), frame.stepNumber ?? -1);
    }
  }

  push(frame: AgentRuntimeGuidance): void {
    if (!this.seen.has(guidanceKey(frame))) this.frames.push(frame);
  }

  unseen(): readonly AgentRuntimeGuidance[] {
    return this.frames;
  }

  upTo(stepNumber: number): readonly AgentRuntimeGuidance[] {
    const taken: AgentRuntimeGuidance[] = [];
    const keys = new Set<string>();
    for (const frame of this.frames) {
      if (frame.stepNumber === undefined || frame.stepNumber > stepNumber) continue;
      const key = guidanceKey(frame);
      if (keys.has(key)) continue;
      keys.add(key);
      taken.push(frame);
    }
    return taken;
  }

  take(frames: readonly AgentRuntimeGuidance[]): void {
    for (const frame of frames) this.seen.set(guidanceKey(frame), frame.stepNumber ?? -1);
    this.frames = this.frames.filter((frame) => !this.seen.has(guidanceKey(frame)));
  }

  committedThrough(stepNumber: number): void {
    for (const [key, step] of this.seen) {
      if (step <= stepNumber) this.seen.delete(key);
    }
  }
}

function guidanceKey(frame: AgentRuntimeGuidance): string {
  return `${frame.stepNumber ?? ''}:${frame.hook}:${frame.texts.join('\n')}:${frame.sources.flatMap((source) => source.withholds ?? []).join('\n')}`;
}
