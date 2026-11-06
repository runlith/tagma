import { Layer } from '@runlith/layer/Layer';
import { Checkout } from './Selection.svelte.js';
import { CheckoutRepo } from './Repo.js';
import { CommitLinks } from './CommitLinks.svelte.js';
import { Holdings } from './Holdings.svelte.js';
import { GitLists } from './GitLists.svelte.js';
import { PathRoads } from './PathRoads.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';
import { ThreadHistory } from './ThreadHistory.svelte.js';
import { LinkKinds, LinkMenuItems } from '$lib/features/opening/Link.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { Actions } from '$lib/features/workspace/action.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { actions } from './actions.js';
import { items, links } from './links.js';
import { panes } from './panes.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const CheckoutLayer = Layer.mergeAll(
  Surfaces.contribute('checkout', ...surfaces),
  Panes.contribute('checkout', ...panes),
  SettingSections.contribute('checkout', ...sections),
  LinkKinds.contribute('checkout', ...links),
  LinkMenuItems.contribute('checkout', ...items),
  Actions.contribute('checkout', { id: 'checkout', area: 'Files', actions }),
  Checkout,
  Holdings,
  CheckoutRepo,
  CommitLinks,
  GitLists,
  PathRoads,
  ThreadChanges,
  ThreadHistory,
);
