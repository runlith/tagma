import { Service } from '@runlith/layer/key';
import { Seams } from '$lib/shared/seams/Seams.svelte.js';
import { AREA_SEAM } from './seams.js';

const AREA = AREA_SEAM.pane;

export const MAIN_MIN = 480;

export class AreaFrame extends Service<AreaFrame>()('AreaFrame', { tier: 'app' }) {
  static *make() {
    return new AreaFrame(yield* Seams);
  }

  private measured = $state(0);

  private dockedWidth = $state(0);

  constructor(private readonly seams: Seams) {
    super();
  }

  get stage(): number {
    return this.measured;
  }

  get docked(): number {
    return this.dockedWidth;
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

  dock(width: number): void {
    this.dockedWidth = width;
  }

  resize(width: number): void {
    this.seams.set(AREA_SEAM, width);
  }
}
