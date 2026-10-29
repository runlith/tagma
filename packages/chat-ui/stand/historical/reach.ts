const HEAD_REACH_PX = 200;

export const pagingMargin = (root: HTMLElement, _head: number): number => root.scrollTop - HEAD_REACH_PX;
