import { CommandCursor, type CommandSelection } from '../contract/wire/commands.js';
import { subjectKeyOf } from '../contract/wire/commandSubject.js';
import type { CommandRecord } from '../contract/wire/commands.js';
import { encode } from '../terminals/subjectPolicy.js';

export type CommandPosition = {
  readonly admittedAt: number;
  readonly execution: string;
};

export const selectionKey = (projectId: number, selection: CommandSelection): string =>
  encode([
    projectId,
    selection.owner === undefined ? null : subjectKeyOf(selection.owner),
    selection.standing ?? null,
    selection.order ?? null,
  ]);

export const positionOf = (record: CommandRecord): CommandPosition => ({
  admittedAt: record.admittedAt,
  execution: record.execution.execution,
});

const CURSOR_PARTS = 3;

export const mintCursor = (filters: string, at: CommandPosition): CommandCursor =>
  CommandCursor.make(encode([filters, at.admittedAt, at.execution]));

export const readCursor = (cursor: string): { readonly filters: string; readonly at: CommandPosition } | null => {
  const decoded = ((): unknown => {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  })();
  if (!Array.isArray(decoded) || decoded.length !== CURSOR_PARTS) return null;
  const [filters, admittedAt, execution] = decoded as readonly unknown[];
  if (typeof filters !== 'string' || typeof admittedAt !== 'number' || typeof execution !== 'string') return null;
  return { filters, at: { admittedAt, execution } };
};
