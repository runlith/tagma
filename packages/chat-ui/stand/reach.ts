const HEAD_REACH_VIEWPORTS = 3;
const RUNWAY_VIEWPORTS = 3;

export const pagingMargin = (root: HTMLElement, head: number): number =>
  head - (RUNWAY_VIEWPORTS + HEAD_REACH_VIEWPORTS) * root.clientHeight;
