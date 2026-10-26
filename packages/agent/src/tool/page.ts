import type { ToolDisplay, ToolDisplayItem } from './display';

export type ToolPageRow = {
  readonly label: string;
  readonly facts?: readonly string[];
};

export type ToolPageInput = {
  readonly rows: readonly ToolPageRow[];
  readonly total: number | null;
  readonly order: string;
  readonly next?: string;
  readonly empty: string;
  readonly note?: string;
  readonly title?: string;
  readonly subtitle?: string;
};

const rowText = (row: ToolPageRow): string =>
  row.facts === undefined || row.facts.length === 0 ? row.label : `${row.label} · ${row.facts.join(' · ')}`;

export function toolPageFooter(input: ToolPageInput): string {
  const shown = input.total === null ? `showing ${input.rows.length}, total not counted` : `showing ${input.rows.length} of ${input.total}`;
  const parts = [shown, input.order];
  if (input.next !== undefined) parts.push(`next: ${input.next}`);
  return parts.join(' · ');
}

export function toolPageText(input: ToolPageInput): string {
  const note = input.note === undefined ? [] : [input.note];
  if (input.rows.length === 0) {
    return input.total === 0 ? [input.empty, ...note].join('\n') : [input.empty, ...note, toolPageFooter(input)].join('\n');
  }
  return [...input.rows.map(rowText), ...note, toolPageFooter(input)].join('\n');
}

export function toolPageDisplay(input: ToolPageInput): ToolDisplay {
  const items: ToolDisplayItem[] = input.rows.map((row) => ({
    label: row.label,
    detail: row.facts === undefined || row.facts.length === 0 ? undefined : row.facts.join(' · '),
  }));
  return {
    form: 'list',
    title: input.title,
    subtitle: input.subtitle,
    items,
    total: input.total ?? undefined,
    facts: [
      { label: 'shown', value: input.total === null ? `${input.rows.length}, not counted` : `${input.rows.length} of ${input.total}` },
    ],
  };
}
