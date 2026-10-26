import { Layer } from '@runlith/layer/Layer';
import { Checkout } from './Selection.svelte.js';
import { CheckoutRepo } from './Repo.js';
import { CommitLinks } from './CommitLinks.svelte.js';
import { Holdings } from './Holdings.svelte.js';
import { GitLists } from './GitLists.svelte.js';
import { PathRoads } from './PathRoads.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';
import { ThreadHistory } from './ThreadHistory.svelte.js';

export const CheckoutLayer = Layer.mergeAll(
  Checkout,
  Holdings,
  CheckoutRepo,
  CommitLinks,
  GitLists,
  PathRoads,
  ThreadChanges,
  ThreadHistory,
);
