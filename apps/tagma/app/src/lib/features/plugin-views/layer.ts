import { Layer } from '@runlith/layer/Layer';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { ViewCapabilities } from './capabilities.js';
import { panes } from './panes.js';
import { PluginActions } from './PluginActions.svelte.js';
import { PluginModules } from './PluginModules.js';
import { Sections } from './Sections.svelte.js';
import { surfaces } from './surfaces.js';
import { ViewSets } from './ViewSets.svelte.js';
import { FloatingPanels } from './windows/FloatingPanels.svelte.js';

export const PluginViewsLayer = Layer.mergeAll(
  Surfaces.contribute('plugin-views', ...surfaces),
  Panes.contribute('plugin-views', ...panes),
  ViewCapabilities,
  PluginModules,
  ViewSets,
  Sections,
  PluginActions,
  FloatingPanels,
);
