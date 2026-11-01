import { Layer } from '@runlith/layer/Layer';
import { Live } from './Live.js';
import { Door } from './Door.js';
import { LaneSockets } from './LaneSockets.js';
import { Restart } from './Restart.svelte.js';
import { SessionNaming } from './SessionNaming.svelte.js';
import { SoundChannel } from './SoundChannel.js';
import { WireCatalog } from './WireCatalog.js';
import { WireEntryKinds } from './WireEntryKinds.js';

export const WireLayer = Layer.mergeAll(WireCatalog, WireEntryKinds, Door, Live, Restart, SessionNaming, SoundChannel, LaneSockets);
