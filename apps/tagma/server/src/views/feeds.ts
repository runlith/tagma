import { Stream } from 'effect';
import { refusingStream } from '../platform/contract/service/body.js';
import type { TagmaAppViews, ViewMount, ViewSites } from './contract/service/views.js';

export const viewChannels = (views: TagmaAppViews['Service'], sites: ViewSites['Service']) => ({
  'views.subscribe': ({ projectId }: { readonly projectId: number }) => Stream.orDie(views.sets(projectId, sites)),
  'views.resource.subscribe': ({ uri, ...mount }: ViewMount & { readonly uri: string }) => refusingStream(views.watch(mount, uri)),
});
