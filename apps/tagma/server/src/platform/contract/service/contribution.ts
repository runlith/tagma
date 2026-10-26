import type { Contributed, Contribution } from '../wire/contribution.js';
import type { Manifest } from './manifest.js';

type Identified = { readonly id: string };

const carried = new WeakMap<Contribution, { readonly point: object; readonly entry: Identified }>();

export class ContributionPoint<A extends Identified> {
  constructor(readonly id: string) {}

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
