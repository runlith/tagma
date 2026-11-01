import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import { type Gated, gatedBy } from '$lib/wire/access.js';

type PartProps = Record<string, never>;

interface WindowPart extends Shown<PartProps>, Gated<Shown<PartProps>['payload']> {
  readonly id: string;
  readonly order: number;
}

const declared = {
  tier: 'app',
  key: (part: WindowPart) => part.id,
  order: (part: WindowPart) => part.order,
  draws: gatedBy<WindowPart>('read'),
} as const;

export const TopBarParts = Point.define<WindowPart>()('TopBarParts', declared);

export const WindowParts = Point.define<WindowPart>()('WindowParts', declared);
