import { Layer } from '@runlith/layer/Layer';
import { Live } from './Live.js';
import { Door } from './Door.js';
import { Restart } from './Restart.svelte.js';
import { SessionNaming } from './SessionNaming.svelte.js';
import { SoundChannel } from './SoundChannel.js';

export const WireLayer = Layer.mergeAll(Door, Live, Restart, SessionNaming, SoundChannel);
