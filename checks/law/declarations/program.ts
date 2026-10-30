import { type Answer, defineProgram, type Finding, type InspectionInput } from '@runlith/tagma/rules';
import { isManifest, productionOf, type Reach } from './corpus';
import type { DeadParams, RepeatedParams } from './declaration';
import { dead, type Judge, repeated } from './gate';
import { changesBetween, prepare } from './index';
import { carryResult, familyOf, resultAt, saveResult } from './results';

type Params = Reach & { readonly region: readonly string[] };

const judged =
  <P extends Params>(root: string, judge: Judge<P>) =>
  async (input: InspectionInput<P>): Promise<Answer> => {
    const { tree, base, params } = input;
    const family = familyOf(judge.kind, params);
    const wholeOf = (commit: string): readonly Finding[] => {
      const held = resultAt(root, family, commit);
      if (held !== undefined) return held;
      const found = judge.whole(root, commit, params);
      saveResult(root, family, commit, found);
      return found;
    };
    const reading = (findings: readonly Finding[]) => ({ findings, covered: 'reach' as const });
    if (tree.whole || base === null || base.whole) {
      const found = wholeOf(tree.commit);
      if (found.length === 0 || base === null) return { tree: reading(found) };
      return { tree: reading(found), base: reading(wholeOf(base.commit)) };
    }
    const production = productionOf(params);
    if (![...tree.paths, ...base.paths].some((path) => production(path) || isManifest(path))) {
      carryResult(root, family, base.commit, tree.commit);
      return { tree: { findings: [], covered: 'paths' } };
    }
    prepare(root, tree.commit, base.commit);
    const held = resultAt(root, family, tree.commit);
    if (held !== undefined) return { tree: reading(held), base: reading(wholeOf(base.commit)) };
    const standing = wholeOf(base.commit);
    const derived = judge.derive(root, base.commit, tree.commit, changesBetween(root, base.commit, tree.commit), standing, params);
    const found = derived ?? judge.whole(root, tree.commit, params);
    saveResult(root, family, tree.commit, found);
    return { tree: reading(found), base: reading(standing) };
  };

export const programs = (root: string) =>
  defineProgram<{ 'repeated-declarations': RepeatedParams; 'dead-code': DeadParams }>({
    'repeated-declarations': judged<RepeatedParams>(root, repeated),
    'dead-code': judged<DeadParams>(root, dead),
  });

export default programs(process.cwd());
