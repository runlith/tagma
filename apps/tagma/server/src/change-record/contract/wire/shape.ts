export const SHAPE_REFUSALS = [
  'format-missing',
  'format-failed',
  'format-cut',
  'derive-required',
  'derive-missing',
  'derive-failed',
  'derive-cut',
  'walk-cut',
  'config-invalid',
  'config-unstored',
  'config-unrunnable',
] as const;

export type ShapeRefusal = (typeof SHAPE_REFUSALS)[number];
