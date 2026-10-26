export type ChannelId = 'stable' | 'dev';

export type Channel = {
  readonly id: ChannelId;
  readonly name: string;
  readonly bundleId: string;
  readonly data: string;
  readonly port: number;
  readonly command: string;
};

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
