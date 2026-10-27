import { Service } from '@runlith/layer/key';
import type { Seam } from '@runlith/seam/Seam.svelte';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import { AREA_SEAM } from './seams.js';

const AREA = AREA_SEAM.pane;

export const MAIN_MIN = 480;

export type FramePlace = 'column' | 'area';

export class AreaFrame extends Service<AreaFrame>()('AreaFrame', { tier: 'app' }) {
  static *make() {
    return new AreaFrame(yield* Seams);
  }

  private measured = $state(0);

  private shown = $state<Record<FramePlace, Seam | null>>({ column: null, area: null });

  constructor(private readonly seams: Seams) {
    super();
  }

  get stage(): number {
    return this.measured;
  }

  get docked(): number {
    return this.shown.area?.size ?? 0;
  }

  get column(): Seam | null {
    return this.shown.column;
  }

  get area(): Seam | null {
    return this.shown.area;
  }

  get width(): number {
    return Math.round(Math.min(Math.max(this.seams.size(AREA_SEAM) ?? AREA.base, AREA.min), AREA.max));
  }

  get room(): number {
    if (this.measured <= 0) return AREA.max;
    return Math.max(AREA.min, Math.min(AREA.max, this.measured - MAIN_MIN));
  }

  measure(stage: number): void {
    this.measured = stage;
  }

  show(place: FramePlace, seam: Seam): () => void {
    this.shown[place] = seam;
    return () => {
      if (this.shown[place] === seam) this.shown[place] = null;
    };
  }

  resize(width: number): void {
    this.seams.set(AREA_SEAM, width);
  }
}
