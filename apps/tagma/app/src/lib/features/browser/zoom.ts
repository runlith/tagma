export const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const zoomStep = (zoom: number, direction: 1 | -1): number => {
  const at = ZOOMS.findIndex((step) => step >= zoom - 0.001);
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? ZOOMS.length - 1 : at) + direction))] ?? 1;
};
