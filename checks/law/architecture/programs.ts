import { defineProgram, type Answer, type Finding, type InspectionInput, type Side } from '@runlith/tagma/rules';
import type { VendorParams } from './inspections';
import { snapshots } from './snapshot';
import { vendorJudge } from './vendors';

type Judged = {
  readonly whole: (tree: Side, base: Side | null) => { readonly tree: readonly Finding[]; readonly base: readonly Finding[] | undefined };
  readonly affected: (
    base: Side,
    tree: Side,
  ) => { readonly paths: ReadonlySet<string>; readonly base: readonly Finding[]; readonly tree: readonly Finding[] };
};

const root = (): string => process.cwd();

let held: ReturnType<typeof snapshots> | undefined;
const snapshot = (): ReturnType<typeof snapshots> => (held ??= snapshots(root()));

const answered = <P extends object>(input: InspectionInput<P>, judged: Judged): Answer => {
  const { tree, base } = input;
  if (tree.whole || base === null || base.whole) {
    const found = judged.whole(tree, base);
    return {
      tree: { covered: 'reach', findings: found.tree },
      base: found.base === undefined ? undefined : { covered: 'reach', findings: found.base },
    };
  }
  const found = judged.affected(base, tree);
  const covered = (side: Side): readonly string[] => [...new Set([...found.paths, ...side.paths])];
  return { tree: { covered: covered(tree), findings: found.tree }, base: { covered: covered(base), findings: found.base } };
};

export default defineProgram<{
  'vendor-ids': VendorParams;
}>({
  'vendor-ids': (input) => {
    const judge = vendorJudge(root(), input.tree.commit, input.params, snapshot());
    return answered(input, {
      whole: (tree, base) => ({ tree: judge.whole(tree), base: base === null ? undefined : judge.whole(base) }),
      affected: judge.affected,
    });
  },
});
