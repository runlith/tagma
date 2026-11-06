import { Layer } from '@runlith/layer/Layer';
import { LinkKinds, LinkMenuItems } from '$lib/features/opening/Link.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { Actions } from '$lib/features/workspace/action.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { actions } from './actions.js';
import { ClosedPages } from './ClosedPages.svelte.js';
import { DesktopPages } from './DesktopPages.svelte.js';
import { items, links } from './links.js';
import { Links } from './Links.svelte.js';
import { OpenPages } from './OpenPages.svelte.js';
import { panes } from './panes.js';
import { Picks } from './pick/Picks.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const BrowserLayer = Layer.mergeAll(
  Surfaces.contribute('browser', ...surfaces),
  Panes.contribute('browser', ...panes),
  SettingSections.contribute('browser', ...sections),
  LinkKinds.contribute('browser', ...links),
  LinkMenuItems.contribute('browser', ...items),
  Actions.contribute('browser', { id: 'browser', area: 'Browser', actions }),
  DesktopPages,
  Links,
  Picks,
  OpenPages,
  ClosedPages,
);
