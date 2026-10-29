import type { PaneContent } from '$lib/shared/panes/pane.js';

export const BLOCK_PANE = 'block';

export type PlacedBlock = {
  readonly projectId: number;
  readonly branch: string | null;
  readonly name: string;
  readonly diff: string | null;
  readonly lang: string | null;
};

type Stored =
  | readonly [projectId: number, branch: string | null, name: string, diff: string | null]
  | readonly [projectId: number, branch: string | null, name: string, diff: null, lang: string];

export const blockPane = (placed: PlacedBlock): PaneContent => ({
  kind: BLOCK_PANE,
  id: JSON.stringify(
    (placed.lang === null || placed.diff !== null
      ? [placed.projectId, placed.branch, placed.name, placed.diff]
      : [placed.projectId, placed.branch, placed.name, null, placed.lang]) satisfies Stored,
  ),
});

const named = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value !== '');

export function placedBlockOf(id: string | null): PlacedBlock | null {
  let stored: unknown;
  try {
    stored = JSON.parse(id ?? 'null');
  } catch {
    return null;
  }
  if (!Array.isArray(stored) || (stored.length !== 4 && stored.length !== 5)) return null;
  const [projectId, branch, name, diff, lang = null] = stored as unknown[];
  if (typeof projectId !== 'number' || !Number.isInteger(projectId) || projectId <= 0) return null;
  if (!named(branch) || !named(diff) || !named(lang) || typeof name !== 'string' || name === '') return null;
  return { projectId, branch, name, diff, lang };
}
