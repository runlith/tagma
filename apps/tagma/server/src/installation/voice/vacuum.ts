import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { StoreSize } from '../../platform/contract/wire/vacuum.js';
import type { VacuumAnswer } from '../contract/wire/operations.js';

const weight = (size: StoreSize): number => size.pages * size.pageSize;

export function vacuumText({ vacuum }: VacuumAnswer): string {
  const { before, after, pagesReturned, heldMs } = vacuum;
  return [
    `${pagesReturned} pages returned, the database held for ${(heldMs / 1000).toFixed(1)}s`,
    `pages ${before.pages} → ${after.pages}, free ${before.freePages} → ${after.freePages}`,
    `${weight(before)} → ${weight(after)} bytes at ${after.pageSize} per page`,
  ].join('\n');
}

export function vacuumDisplay({ vacuum }: VacuumAnswer): ToolDisplay {
  return {
    form: 'none',
    title: 'the database vacuumed',
    facts: [
      { label: 'pages returned', value: String(vacuum.pagesReturned) },
      { label: 'held', value: `${(vacuum.heldMs / 1000).toFixed(1)}s` },
    ],
  };
}
