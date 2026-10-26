const BOUND_VALUES = 32766;

export const PAGE_TEXT = 1_000_000;

export const PAGE_VALUES = 8_000;

export function rowsPerStatement(columns: number): number {
  return Math.max(1, Math.floor(BOUND_VALUES / columns));
}

export function pagesOf<T>(rows: readonly T[], columns: number, text: (row: T) => number = () => 0): T[][] {
  const most = Math.max(1, Math.min(rowsPerStatement(columns), Math.floor(PAGE_VALUES / columns)));
  const pages: T[][] = [];
  let page: T[] = [];
  let carried = 0;
  for (const row of rows) {
    const weight = text(row);
    if (page.length > 0 && (page.length >= most || carried + weight > PAGE_TEXT)) {
      pages.push(page);
      page = [];
      carried = 0;
    }
    page.push(row);
    carried += weight;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
