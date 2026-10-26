import { homedir } from 'node:os';
import { join } from 'node:path';
import { HARNESSES } from '../contract/service/table.js';
import type { HookFormat } from '../contract/service/adapter.js';
import { entryLine } from '../../installation/contract/wire/junction.js';

const ENTRY_WORD = entryLine('')
  .trimEnd()
  .replace(/[.*+?^${}()|[\]\\/"]/g, (char) => `\\${char}`);

const TAGMA_COMMAND = new RegExp(
  `^(?:${ENTRY_WORD}|t=\\$\\(command -v [a-z-]+(?: \\|\\| command -v [a-z-]+)*\\) \\|\\| exit 0; exec "\\$t"|(?:command -v tagma >\\/dev\\/null 2>&1 \\|\\| exit 0; exec )?tagma|"[^"]+"\\s+"[^"]+\\/main\\.js")\\s+(prime|hook\\s+[a-z-]+(?:\\s+--harness\\s+[a-z-]+)?)$`,
);

export const ownedEntry = (at: Record<string, unknown>): string | null =>
  typeof at.command === 'string' && TAGMA_COMMAND.test(at.command.trim()) ? at.command : null;

export const portableEntry = (at: Record<string, unknown>): string | null => {
  const verb = typeof at.command === 'string' ? TAGMA_COMMAND.exec(at.command.trim())?.[1] : undefined;
  return verb === undefined ? null : entryLine(verb);
};

export const nestedOf = (group: Record<string, unknown>): unknown[] => (Array.isArray(group.hooks) ? group.hooks : [group]);

export type OwnPlace = { readonly event: string; readonly group: number; readonly handler: number };

export function ownPlaces(doc: unknown): OwnPlace[] {
  const root = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  const held = root.hooks;
  const events = held !== null && typeof held === 'object' && !Array.isArray(held) ? (held as Record<string, unknown>) : {};
  const places: OwnPlace[] = [];
  for (const [event, standing] of Object.entries(events)) {
    if (!Array.isArray(standing)) continue;
    standing.forEach((group, groupIndex) => {
      if (group === null || typeof group !== 'object') return;
      nestedOf(group as Record<string, unknown>).forEach((entry, handler) => {
        if (entry === null || typeof entry !== 'object') return;
        if (ownedEntry(entry as Record<string, unknown>) === null) return;
        places.push({ event, group: groupIndex, handler });
      });
    });
  }
  return places;
}

export const hookSurfaces = (): readonly { readonly file: string; readonly format: HookFormat }[] => {
  const byFile = new Map<string, HookFormat>();
  for (const adapter of HARNESSES) {
    if (adapter.hooks !== null && !byFile.has(adapter.hooks.file)) byFile.set(adapter.hooks.file, adapter.hooks.format);
  }
  return [...byFile].map(([file, format]) => ({ file, format }));
};

export function skillTarget(repoRoot: string): string {
  return join(repoRoot, '.agents', 'skills', 'tagma');
}

export function userSkillTarget(directory: string | null = process.env.CLAUDE_CONFIG_DIR ?? null): string {
  return join(directory === null || directory === '' ? join(homedir(), '.claude') : directory, 'skills', 'tagma');
}

export function skillLinkTarget(repoRoot: string): string {
  return join(repoRoot, '.claude', 'skills', 'tagma');
}
