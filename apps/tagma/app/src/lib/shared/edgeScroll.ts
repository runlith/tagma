const EDGE_PX = 30;
const TOP_SPEED_PX = 14;

export function edgeScroll(at: number, low: number, high: number): number {
  if (at < low + EDGE_PX) return -Math.min(TOP_SPEED_PX, Math.ceil((low + EDGE_PX - at) / 3));
  if (at > high - EDGE_PX) return Math.min(TOP_SPEED_PX, Math.ceil((at - (high - EDGE_PX)) / 3));
  return 0;
}
