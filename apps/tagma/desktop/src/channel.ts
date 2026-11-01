import { CHANNEL as DEVELOPER_CHANNEL } from '@tagma/server/composition/developer/channel';
import type { Channel } from '@tagma/server/installation/contract/wire/channel';

declare const BUILT_CHANNEL: Channel | undefined;

export const CHANNEL_DEFINE = 'BUILT_CHANNEL';

export const CHANNEL: Channel = typeof BUILT_CHANNEL === 'object' ? BUILT_CHANNEL : DEVELOPER_CHANNEL;
