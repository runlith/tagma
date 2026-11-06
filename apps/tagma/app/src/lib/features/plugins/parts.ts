import type { PluginComponent } from '@tagma/server/plugins/contract/wire/rows';
import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';

export type CardPartProps = {
  readonly plugin: string;
  readonly components: readonly PluginComponent[];
  readonly runEverywhere: () => Promise<boolean>;
};

interface CardPart extends Shown<CardPartProps> {
  readonly contribution: string;
  readonly order: number;
}

export const CardParts = Point.define<CardPart>()('CardParts', {
  tier: 'app',
  key: (part) => part.contribution,
  order: (part) => part.order,
});
