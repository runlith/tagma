import { type CapabilityDeclaration, TAGMA_VIEW } from '@tagma/server/views/contract/wire/capabilities';
import { Point } from '@runlith/layer/Point';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';

export type CapabilityOwners = { readonly door: Door; readonly live: LiveConnection; readonly sound: SoundChannel };

export type CapabilityMount = {
  readonly projectId: number;
  readonly plugin: string;
  readonly view: string;
  readonly ended: AbortSignal;
};

export interface ViewCapability {
  readonly declaration: CapabilityDeclaration;
  readonly make: (owners: CapabilityOwners, mount: CapabilityMount) => unknown;
}

const OWN: ReadonlySet<string> = new Set([...TAGMA_VIEW.map(({ id }) => id), 'plugin', 'view', 'threadId', 'key']);

export const ViewCapabilities = Point.define<ViewCapability>()('ViewCapabilities', {
  tier: 'app',
  key: ({ declaration }) => declaration.id,
  admits: ({ declaration }) => (OWN.has(declaration.id) ? `useTagma() serves "${declaration.id}" itself` : null),
  claims: ({ declaration }) => [`View capability "${declaration.id}"`],
});
