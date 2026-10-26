export const SHAPE_REFUSALS = [
  'format-missing',
  'format-failed',
  'format-cut',
  'config-invalid',
  'config-unstored',
  'config-unrunnable',
] as const;

export type ShapeRefusal = (typeof SHAPE_REFUSALS)[number];
