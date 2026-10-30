import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HookCodec } from '@runlith/tagma/adapter/hook';
import { hookGroups } from './hookInstall.js';
import { entryLine } from '../../installation/contract/wire/junction.js';

const ENTRY_WORD = entryLine('')
  .trimEnd()
  .replace(/[.*+?^${}()|[\]\\/"]/g, (char) => `\\${char}`);

const TAGMA_COMMAND = new RegExp(
  `^(?:${ENTRY_WORD}|t=\\$\\(command -v [a-z-]+(?: \\|\\| command -v [a-z-]+)*\\) \\|\\| exit 0; exec "\\$t"|(?:command -v tagma >\\/dev\\/null 2>&1 \\|\\| exit 0; exec )?tagma|"[^"]+"\\s+"[^"]+\\/main\\.js")\\s+(prime|hook\\s+[a-z-]+(?:\\s+--harness\\s+[a-z0-9][a-z0-9-]*)?)$`,
);

export const ownedEntry = (at: Record<string, unknown>): string | null =>
  typeof at.command === 'string' && TAGMA_COMMAND.test(at.command.trim()) ? at.command : null;

export const portableEntry = (at: Record<string, unknown>): string | null => {
  const verb = typeof at.command === 'string' ? TAGMA_COMMAND.exec(at.command.trim())?.[1] : undefined;
  return verb === undefined ? null : entryLine(verb);
};

export const nestedOf = (group: Record<string, unknown>): unknown[] => (Array.isArray(group.hooks) ? group.hooks : [group]);

export type OwnPlace = { readonly event: string; readonly group: number; readonly handler: number };

export const eventsIn = (root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | null => {
  let at: unknown = root;
  for (const step of path) {
    if (at === null || typeof at !== 'object' || Array.isArray(at)) return null;
    at = (at as Record<string, unknown>)[step];
  }
  return at !== null && typeof at === 'object' && !Array.isArray(at) ? (at as Record<string, unknown>) : null;
};

export function ownPlaces(doc: unknown, path: readonly string[]): OwnPlace[] {
  const root = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  const events = eventsIn(root, path) ?? {};
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

export const hookSurfaces = (adapters: readonly HarnessAdapter[]): readonly { readonly file: string; readonly codec: HookCodec }[] =>
  hookGroups(adapters, (surface) => surface.file).map(({ file, codec }) => ({ file, codec }));

export function skillTarget(repoRoot: string): string {
  return join(repoRoot, '.agents', 'skills', 'tagma');
}

export function userSkillTarget(directory: string | null = process.env.CLAUDE_CONFIG_DIR ?? null): string {
  return join(directory === null || directory === '' ? join(homedir(), '.claude') : directory, 'skills', 'tagma');
}

export function skillLinkTarget(repoRoot: string): string {
  return join(repoRoot, '.claude', 'skills', 'tagma');
}
