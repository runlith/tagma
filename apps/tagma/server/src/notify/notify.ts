import { Context } from 'effect';
import { notify as declaration } from './contract/wire/module.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { Notifications } from './contract/service/notifications.js';
import type { NotifyLive } from './contract/service/live.js';
import { NOTIFY_FEEDS } from './contract/wire/notification.js';
import { notify as notifySection } from './doctrine/notify.js';

const live: NotifyLive = liveOf(NOTIFY_FEEDS, async (door) => {
  const { notificationsFeed } = await import('./feed.js');
  return { 'notifications.subscribe': () => notificationsFeed(Context.get(door, Notifications).changes) };
});

export const notify = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).NOTIFY_PAIRS),
  live,
  sections: [{ id: 'notify', place: { prompt: 215 }, owner: 'notify', render: notifySection, path: 'src/notify/doctrine/notify.ts' }],
  tables: async () => {
    const { notification } = await import('./store/tables.js');
    return { entities: [], history: [notification] };
  },
  drivers: [{ id: 'notification-retention' }],
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ notifyLayer }) => notifyLayer,
    ),
  },
});
