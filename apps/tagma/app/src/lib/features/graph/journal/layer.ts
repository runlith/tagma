import { Layer } from '@runlith/layer/Layer';
import { JournalLive } from './Live.svelte.js';

export const JournalLayer = Layer.mergeAll(JournalLive);
