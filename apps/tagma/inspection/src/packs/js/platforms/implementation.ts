import type { Implementation } from '../../../core/node/reading';
import { localOf, picks } from '../../../core/node/select';
import { mergeSlices, WHOLE } from '../../../core/node/slices';
import { carries, compares } from './carry';
import type { platforms as declared } from './declaration';
import { planSlices } from './plan';
import { inside, pathOf, snapshotOf } from './snapshot';
import { measuredSlice, readSlice } from './walk';

type Of = typeof declared.params.Type;

const selects = (params: Of, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && (path.endsWith('package.json') || picks(params.files, local));
};

export const platforms: Implementation<Of> = {
  lists: () => [''],
  selects,
  movable: (params, path) =>
    selects(params, path) ||
    params.apps.some((app) => {
      const at = pathOf(params.base, app.at);
      return inside(path, at) && picks(app.files, path.slice(at.length + 1));
    }) ||
    (params.programs ?? []).some((program) => pathOf(params.base, program.at) === path),
  prefetch: false,
  read: (params, tree, _paths, _adapters, _budget, memo) => mergeSlices([readSlice(params, tree, WHOLE, memo)]),
  slices: { snapshot: snapshotOf, carries, compares, plan: planSlices, measured: measuredSlice, read: readSlice },
};
