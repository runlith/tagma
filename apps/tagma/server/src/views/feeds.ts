import { Stream } from 'effect';
import { refusingStream } from '../platform/contract/service/body.js';
import type { PluginActions } from './contract/service/actions.js';
import type { PluginViews, ViewMount } from './contract/service/views.js';

export const viewChannels = (views: PluginViews['Service'], actions: PluginActions['Service']) => ({
  'views.subscribe': ({ projectId }: { readonly projectId: number }) => Stream.orDie(views.sets(projectId)),
  'views.resource.subscribe': ({ uri, ...mount }: ViewMount & { readonly uri: string }) => refusingStream(views.watch(mount, uri)),
  'views.actions': () => Stream.orDie(actions.sets),
});
