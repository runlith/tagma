import { applyTail } from '@tagma/server/threads/contract/wire/tail';
import type { PresenceEvent, PresenceMissingReason, PresenceRow } from '@tagma/server/threads/contract/wire/presence';

export interface PresenceCell {
  row: PresenceRow | undefined;
  revision: number;
  missing: PresenceMissingReason | undefined;
}

export function applyPresence(cells: ReadonlyMap<string, PresenceCell>, event: PresenceEvent): void {
  switch (event.type) {
    case 'initial': {
      const answered = new Set<string>();
      for (const entry of event.entries) {
        const id = entry.type === 'row' ? entry.row.threadId : entry.threadId;
        const cell = cells.get(id);
        if (cell === undefined) continue;
        answered.add(id);
        cell.row = entry.type === 'row' ? entry.row : undefined;
        cell.revision = entry.type === 'row' ? entry.revision : 0;
        cell.missing = entry.type === 'row' ? undefined : entry.reason;
      }
      for (const [id, cell] of cells) {
        if (answered.has(id)) continue;
        cell.row = undefined;
        cell.revision = 0;
        cell.missing = undefined;
      }
      return;
    }
    case 'changed': {
      const cell = cells.get(event.threadId);
      if (cell?.row === undefined || event.revision <= cell.revision) return;
      cell.row = { ...cell.row, ...event.fields };
      cell.revision = event.revision;
      return;
    }
    case 'tail': {
      const cell = cells.get(event.threadId);
      if (cell?.row === undefined || event.revision <= cell.revision) return;
      const { tail: standing, ...rest } = cell.row;
      if (event.tail === null) {
        cell.row = rest;
      } else {
        const tail = applyTail(standing, event.tail);
        if (tail === undefined) return;
        cell.row = { ...rest, tail };
      }
      cell.revision = event.revision;
      return;
    }
    case 'missing': {
      const cell = cells.get(event.threadId);
      if (cell === undefined) return;
      cell.row = undefined;
      cell.revision = 0;
      cell.missing = event.reason;
      return;
    }
  }
}
