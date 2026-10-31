import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { panes } from './panes.js';
import { Sections } from './Sections.svelte.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';
import { TagmaAppActions } from './TagmaAppActions.svelte.js';
import { ViewSets } from './ViewSets.svelte.js';
import { FloatingPanels } from './windows/FloatingPanels.svelte.js';

export const TagmaAppsLayer = Layer.mergeAll(
  Surfaces.contribute('tagma-apps', ...surfaces),
  Panes.contribute('tagma-apps', ...panes),
  SettingSections.contribute('tagma-apps', ...sections),
  ViewSets,
  Sections,
  TagmaAppActions,
  FloatingPanels,
);
