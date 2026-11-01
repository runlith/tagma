import { type BridgeMethod, capabilityOf, HOST_BRIDGE, THREAD_CHANGED } from '@tagma/server/views/contract/wire/bridge';
import { Point } from '@runlith/layer/Point';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';
import type { ViewMethod } from '../views/ViewBridge.js';

type MethodOwners = { readonly door: Door; readonly live: LiveConnection; readonly sound: SoundChannel };

type MethodMount = { readonly projectId: number };

export interface TagmaMethod {
  readonly declaration: BridgeMethod;
  readonly method: (owners: MethodOwners, mount: MethodMount) => ViewMethod;
}

const HOSTED = new Set<string>(HOST_BRIDGE.flatMap(({ id }) => [`tagma/${id}`, capabilityOf(id)]));

const admitsOf = ({ declaration }: TagmaMethod): string | null => {
  if (HOSTED.has(`tagma/${declaration.id}`) || HOSTED.has(capabilityOf(declaration.id))) {
    return `the app view host serves "${capabilityOf(declaration.id)}" itself`;
  }
  return declaration.notifications.includes(THREAD_CHANGED) ? `the app view host sends "${THREAD_CHANGED}" itself` : null;
};

export const TagmaMethods = Point.define<TagmaMethod>()('TagmaMethods', {
  tier: 'app',
  key: ({ declaration }) => `tagma/${declaration.id}`,
  admits: admitsOf,
  claims: ({ declaration }) => [
    `View capability "${capabilityOf(declaration.id)}"`,
    ...declaration.notifications.map((notification) => `View notification "${notification}"`),
  ],
});
