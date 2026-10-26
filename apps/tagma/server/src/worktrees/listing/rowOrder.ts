import { keyOrder, type PageKey } from '@runlith/paging';
import type { WorktreeElsewhere } from '../contract/wire/rows.js';
import type { Entry } from './rowShapes.js';

export const DIRECTIONS = ['asc', 'desc', 'asc'] as const;

export const keyOf = (entry: Entry): PageKey => [entry.rank, entry.movedAt, entry.row.rootId];

export const byKey = (left: Entry, right: Entry): number => keyOrder(DIRECTIONS)(keyOf(left), keyOf(right));
