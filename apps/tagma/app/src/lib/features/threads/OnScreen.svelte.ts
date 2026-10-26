import { Service } from '@runlith/layer/key';
import type { ThreadSlot } from './ThreadSlot.svelte.js';

export type ScreenThreads = {
  readonly page: ThreadSlot | null;
  readonly host: ThreadSlot | null;
  readonly shown: readonly ThreadSlot[];
  readonly mainFocused: boolean;
  activation(host: ThreadSlot): number;
};

export class ThreadOnScreen extends Service<ScreenThreads>()('ThreadOnScreen', { tier: 'app' }) {}
