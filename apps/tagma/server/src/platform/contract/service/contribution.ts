import type { Contributed, Contribution, PluginFace } from '../wire/contribution.js';
import type { Manifest } from './manifest.js';

type Identified = { readonly id: string };

export type PluginFaced<W> = { readonly id: string; readonly plugin: PluginFace<W> };

type Faces<W> = [W] extends [never] ? [] : [plugin: PluginFace<W>];

const carried = new WeakMap<Contribution, { readonly point: object; readonly entry: Identified }>();

export class ContributionPoint<A extends Identified, W = never> {
  readonly plugin: [W] extends [never] ? undefined : PluginFace<W>;

  constructor(
    readonly id: string,
    ...faces: Faces<W>
  ) {
    this.plugin = faces[0] as [W] extends [never] ? undefined : PluginFace<W>;
  }

  of(...entries: readonly A[]): readonly Contribution[] {
    return entries.map((entry) => {
      const contribution = Object.freeze({ point: this.id, id: entry.id }) as Contribution;
      carried.set(contribution, { point: this, entry });
      return contribution;
    });
  }

  collect(modules: readonly Manifest[]): readonly Contributed<A>[] {
    return modules.flatMap((module) =>
      (module.contributions ?? []).flatMap((contribution) => {
        const held = carried.get(contribution);
        return held?.point === this ? [{ owner: module.id, entry: held.entry as A }] : [];
      }),
    );
  }
}
