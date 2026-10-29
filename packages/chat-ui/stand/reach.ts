const HEAD_REACH_VIEWPORTS = 3;

export const pagingMargin = (root: HTMLElement, head: number): number => head - HEAD_REACH_VIEWPORTS * root.clientHeight;
