import { Schema } from 'effect';

export const channelSchema = Schema.Struct({
  id: Schema.Literals(['stable', 'dev']),
  name: Schema.String,
  bundleId: Schema.String,
  data: Schema.String,
  port: Schema.Number,
  command: Schema.String,
});

export type Channel = typeof channelSchema.Type;

export type ChannelId = Channel['id'];

export const CHANNELS: { readonly [Id in ChannelId]: Channel & { readonly id: Id } } = {
  stable: {
    id: 'stable',
    name: 'Tagma',
    bundleId: 'com.runlith.tagma',
    data: '.tagma',
    port: 5643,
    command: 'tagma',
  },
  dev: {
    id: 'dev',
    name: 'Tagma Dev',
    bundleId: 'com.runlith.tagma.dev',
    data: '.tagma-dev',
    port: 5633,
    command: 'tagma-dev',
  },
};
