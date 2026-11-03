import type { Resolver } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';

type BlockSectionProps = { read: BlockRead };

export interface BlockSection extends Shown<BlockSectionProps> {
  readonly id: string;
  readonly order: number;
  readonly ready?: (app: Resolver) => (read: BlockRead) => boolean;
}

export const BlockSections = Point.define<BlockSection>()('BlockSections', {
  tier: 'app',
  key: (section) => section.id,
  order: (section) => section.order,
});
