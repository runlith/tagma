import { Stream } from 'effect';
import type { Notifications } from './contract/service/notifications.js';
import type { NotificationsFeedEvent } from './contract/wire/notification.js';

export const notificationsFeed = (changes: Notifications['Service']['changes']): Stream.Stream<NotificationsFeedEvent> =>
  changes.pipe(
    Stream.orDie,
    Stream.map((change): NotificationsFeedEvent => {
      if (change._tag === 'all') return { type: 'list', rows: change.rows };
      if (change._tag === 'put') return { type: 'put', row: change.row };
      return { type: 'gone', id: change.id };
    }),
  );
