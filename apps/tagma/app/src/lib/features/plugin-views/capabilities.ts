import { type CapabilityDeclaration, TAGMA_VIEW } from '@tagma/server/views/contract/wire/capabilities';
import { Layer } from '@runlith/layer/Layer';
import { Point } from '@runlith/layer/Point';

export type CapabilityMount = {
  readonly projectId: number;
  readonly plugin: string;
  readonly view: string;
  readonly ended: AbortSignal;
};

export interface ViewCapabilityMembers {}

export type ViewCapability = {
  readonly [Id in keyof ViewCapabilityMembers & string]: {
    readonly declaration: CapabilityDeclaration & { readonly id: Id };
    readonly make: (mount: CapabilityMount) => ViewCapabilityMembers[Id];
  };
}[keyof ViewCapabilityMembers & string];

const OWN: ReadonlySet<string> = new Set([...TAGMA_VIEW.map(({ id }) => id), 'plugin', 'view', 'threadId', 'key']);

export const ViewCapabilities = Point.define<ViewCapability>()('ViewCapabilities', {
  tier: 'app',
  key: ({ declaration }) => declaration.id,
  admits: ({ declaration }) => (OWN.has(declaration.id) ? `useTagma() serves "${declaration.id}" itself` : null),
  claims: ({ declaration }) => [`View capability "${declaration.id}"`],
});

export const viewCapability = Layer.member(
  () => ViewCapabilities,
  (point: Point<ViewCapability>, capability: ViewCapability, key) => point.register(key.id, capability),
);
