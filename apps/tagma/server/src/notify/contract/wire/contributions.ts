import { Schema } from 'effect';

export const NotificationTool = Schema.Struct({ tool: Schema.NonEmptyString });
export type NotificationTool = typeof NotificationTool.Type;
