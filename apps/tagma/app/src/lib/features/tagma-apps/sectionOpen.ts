import type { Effect } from 'effect';
import type { ShellPort, ShellRefusal } from '$lib/features/workspace/ShellOps.js';
import { INVALID_PARAMS, type ViewParams, ViewRefusal } from '../views/ViewBridge.js';
import { paneId, TAGMA_APP_PANE } from './panes.js';
import { sectionSurface } from './surfaces.js';
import type { ViewSets } from './ViewSets.svelte.js';

const viewOf = (params: ViewParams, field: 'pane' | 'section'): string | undefined => {
  const named = params[field];
  if (named === undefined) return undefined;
  if (typeof named !== 'string' || named === '') throw new ViewRefusal(INVALID_PARAMS, `${field} is the id of one of the app’s views`);
  return named;
};

export function sectionOpening(
  shell: ShellPort,
  sets: ViewSets,
  tagmaApp: string,
  params: ViewParams,
): Effect.Effect<void, ShellRefusal> | null {
  const pane = viewOf(params, 'pane');
  const section = viewOf(params, 'section');
  if (pane === undefined && section === undefined) return null;
  if (pane !== undefined && section !== undefined) throw new ViewRefusal(INVALID_PARAMS, 'name a pane or a section, not both');
  if (!navigator.userActivation.isActive) throw new Error('a pane or a section opens only from a click in the view');
  if (pane !== undefined) {
    if (sets.pane(tagmaApp, pane) === undefined) throw new ViewRefusal(INVALID_PARAMS, `the app ${tagmaApp} contributes no pane ${pane}`);
    return shell.openPane(TAGMA_APP_PANE, paneId(tagmaApp, pane));
  }
  if (sets.surface(tagmaApp, section!) === undefined) {
    throw new ViewRefusal(INVALID_PARAMS, `the app ${tagmaApp} contributes no section ${section}`);
  }
  return shell.revealSurface(sectionSurface(tagmaApp, section!));
}
