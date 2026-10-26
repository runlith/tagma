import { Schema } from 'effect';
import type { Tagged } from './tags/roles.js';
import type { TagReading } from './tags/reading.js';
import { AMENDMENT } from './tags/amendment.js';
import { OBSERVATION } from './tags/observation.js';

export type BlockState = {
  readonly status: string | null;
  readonly superseded?: boolean;
  readonly blocked?: boolean;
  readonly building?: boolean;
  readonly answered?: boolean;
};

export const subtreeShapeSchema = Schema.Struct({
  blocks: Schema.Number,
  depth: Schema.Number,
  widest: Schema.Number,
});
export type SubtreeShape = typeof subtreeShapeSchema.Type;

export function standsInOutline(table: TagReading, row: Tagged): boolean {
  return !(table.supports(row, AMENDMENT) && table.isTerminal(row));
}

export function rests(table: TagReading, row: Tagged & { superseded?: boolean; answered?: boolean }): boolean {
  if (row.superseded === true) return true;
  if (table.isTerminal(row)) return true;
  return table.supports(row, OBSERVATION) && row.answered === true;
}
