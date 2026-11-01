import { Point } from '@runlith/layer/Point';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';
import type { ViewMethod } from '../views/ViewBridge.js';

type MethodOwners = { readonly door: Door; readonly live: LiveConnection; readonly sound: SoundChannel };

type MethodMount = { readonly projectId: number };

export interface TagmaMethod {
  readonly name: string;
  readonly notifications: readonly string[];
  readonly method: (owners: MethodOwners, mount: MethodMount) => ViewMethod;
}

export const THREAD_CHANGED = 'tagma/notifications/thread';

export const HOST_METHODS = ['open', 'storage/get', 'storage/set', 'thread', 'thread/unwatch'] as const;

export type HostMethod = (typeof HOST_METHODS)[number];

export const capabilityOf = (name: string): string => `tagma/${name.split('/')[0]}`;

const HOSTED = new Set<string>([...HOST_METHODS.map((name) => `tagma/${name}`), ...HOST_METHODS.map(capabilityOf)]);

const admitsOf = (declared: TagmaMethod): string | null => {
  if (HOSTED.has(`tagma/${declared.name}`) || HOSTED.has(capabilityOf(declared.name))) {
    return `the app view host serves "${capabilityOf(declared.name)}" itself`;
  }
  return declared.notifications.includes(THREAD_CHANGED) ? `the app view host sends "${THREAD_CHANGED}" itself` : null;
};

export const TagmaMethods = Point.define<TagmaMethod>()('TagmaMethods', {
  tier: 'app',
  key: (declared) => `tagma/${declared.name}`,
  admits: admitsOf,
  claims: (declared) => [
    `View capability "${capabilityOf(declared.name)}"`,
    ...declared.notifications.map((notification) => `View notification "${notification}"`),
  ],
});
