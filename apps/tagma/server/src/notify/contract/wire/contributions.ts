import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

export const NotificationTool = Schema.Struct({ tool: Schema.NonEmptyString });
export type NotificationTool = typeof NotificationTool.Type;

export const NOTIFIER_FACE: PluginFace<NotificationTool> = {
  name: 'notify',
  title: 'Notifications',
  schema: NotificationTool,
  calls: (value) => [value.tool],
};
