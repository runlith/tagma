import type { Schema } from 'effect';
import type { Contributed, Contribution } from '../wire/contribution.js';
import type { Manifest } from './manifest.js';

type Identified = { readonly id: string };

type AppFace<W> = {
  readonly name: string;
  readonly schema: Schema.Codec<W, unknown>;
  readonly claims?: (value: W) => readonly string[];
};

export type AppFaced<W> = { readonly id: string; readonly app: AppFace<W> };

type Faces<W> = [W] extends [never] ? [] : [app: AppFace<W>];

const carried = new WeakMap<Contribution, { readonly point: object; readonly entry: Identified }>();

export class ContributionPoint<A extends Identified, W = never> {
  readonly app: [W] extends [never] ? undefined : AppFace<W>;

  constructor(
    readonly id: string,
    ...faces: Faces<W>
  ) {
    this.app = faces[0] as [W] extends [never] ? undefined : AppFace<W>;
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
