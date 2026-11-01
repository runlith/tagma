import { Point } from '@runlith/layer/Point';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';
import type { ViewMethod } from './ViewBridge.js';

type MethodOwners = { readonly door: Door; readonly live: LiveConnection; readonly sound: SoundChannel };

type MethodMount = { readonly projectId: number };

export interface TagmaMethod {
  readonly name: string;
  readonly notifications: readonly string[];
  readonly method: (owners: MethodOwners, mount: MethodMount) => ViewMethod;
}

export const TagmaMethods = Point.define<TagmaMethod>()('TagmaMethods', {
  tier: 'app',
  key: (declared) => `tagma/${declared.name}`,
  claims: (declared) => declared.notifications.map((notification) => `View notification "${notification}"`),
});
