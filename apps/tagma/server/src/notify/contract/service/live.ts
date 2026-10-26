import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { NOTIFY_FEEDS } from '../wire/notification.js';
import type { Notifications } from './notifications.js';

export type NotifyLive = LiveDeclaration<typeof NOTIFY_FEEDS, Notifications>;
