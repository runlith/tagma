import { type Answer, defineProgram, type Finding, type InspectionInput } from '@runlith/tagma/rules';
import { isManifest, productionOf, type Reach } from './corpus';
import type { DeadParams, RepeatedParams } from './declaration';
import { dead, type Judge, repeated } from './gate';
import { changesBetween, FAR, GOOD_ENOUGH, prepare } from './index';
import { carryResult, familyOf, resultAt, resultTrees, saveResult } from './results';

type Params = Reach & { readonly region: readonly string[] };

const judged =
  <P extends Params>(root: string, judge: Judge<P>) =>
  async (input: InspectionInput<P>): Promise<Answer> => {
    const { tree, base, params } = input;
    const family = familyOf(judge.kind, params);
    const reading = (findings: readonly Finding[]) => ({ findings, covered: 'reach' as const });
    const wholeOf = (commit: string): readonly Finding[] => {
      const held = resultAt(root, family, commit);
      if (held !== undefined) return held;
      const found = judge.whole(root, commit, params);
      saveResult(root, family, commit, found);
      return found;
    };
    if (tree.whole || base === null || base.whole) {
      const found = wholeOf(tree.commit);
      if (found.length === 0 || base === null) return { tree: reading(found) };
      return { tree: reading(found), base: reading(wholeOf(base.commit)) };
    }
    const standingAt = (commit: string): readonly Finding[] => {
      const held = resultAt(root, family, commit);
      if (held !== undefined) return held;
      let nearest: { readonly tree: string; readonly changes: ReturnType<typeof changesBetween> } | undefined;
      for (const cached of resultTrees(root, family)) {
        const changes = changesBetween(root, cached, commit);
        if (nearest === undefined || changes.length < nearest.changes.length) nearest = { tree: cached, changes };
        if (changes.length < GOOD_ENOUGH) break;
      }
      if (nearest === undefined || nearest.changes.length > FAR)
        throw new Error(
          `no cached ${judge.kind} findings within ${FAR} changed files of ${commit}; build them with check_rules over "all" for a rule of this inspection, then judge the change again`,
        );
      prepare(root, commit, nearest.tree);
      const found = judge.derive(root, nearest.tree, commit, nearest.changes, resultAt(root, family, nearest.tree)!, params);
      saveResult(root, family, commit, found);
      return found;
    };
    const production = productionOf(params);
    if (![...tree.paths, ...base.paths].some((path) => production(path) || isManifest(path))) {
      carryResult(root, family, base.commit, tree.commit);
      return { tree: { findings: [], covered: 'paths' } };
    }
    prepare(root, tree.commit, base.commit);
    const held = resultAt(root, family, tree.commit);
    if (held !== undefined) return { tree: reading(held), base: reading(standingAt(base.commit)) };
    const standing = standingAt(base.commit);
    const found = judge.derive(root, base.commit, tree.commit, changesBetween(root, base.commit, tree.commit), standing, params);
    saveResult(root, family, tree.commit, found);
    return { tree: reading(found), base: reading(standing) };
  };

export const programs = (root: string) =>
  defineProgram<{ 'repeated-declarations': RepeatedParams; 'dead-code': DeadParams }>({
    'repeated-declarations': judged<RepeatedParams>(root, repeated),
    'dead-code': judged<DeadParams>(root, dead),
  });

export default programs(process.cwd());
