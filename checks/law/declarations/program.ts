import { type Answer, defineProgram, type Finding, type InspectionInput } from '@runlith/tagma/rules';
import { isManifest, productionOf, type Reach } from './corpus';
import type { DeadParams, RepeatedParams } from './declaration';
import { dead, type Judge, repeated } from './gate';
import { changesBetween, prepare } from './index';

type Params = Reach & { readonly region: readonly string[] };

const WHOLE_KEPT = 4;

const wholes = new Map<string, readonly Finding[]>();

const judged =
  <P extends Params>(root: string, judge: Judge<P>) =>
  async (input: InspectionInput<P>): Promise<Answer> => {
    const { tree, base, params } = input;
    const reading = (findings: readonly Finding[]) => ({ findings, covered: 'reach' as const });
    const wholeOf = (commit: string): readonly Finding[] => {
      const key = `${root}\0${judge.kind}\0${JSON.stringify(params)}\0${commit}`;
      const held = wholes.get(key);
      if (held !== undefined) return held;
      const found = judge.whole(root, commit, params);
      if (wholes.size >= WHOLE_KEPT) wholes.clear();
      wholes.set(key, found);
      return found;
    };
    if (tree.whole || base === null || base.whole) {
      const found = wholeOf(tree.commit);
      if (found.length === 0 || base === null) return { tree: reading(found) };
      return { tree: reading(found), base: reading(wholeOf(base.commit)) };
    }
    const production = productionOf(params);
    if (
      ![...tree.paths, ...base.paths].some(
        (path) => production(path) || isManifest(path) || (judge.kind === 'repeated-declarations' && path.startsWith('.tagma/')),
      )
    )
      return { tree: { findings: [], covered: 'paths' } };
    prepare(root, tree.commit, base.commit);
    const answer = judge.affected(root, base.commit, tree.commit, changesBetween(root, base.commit, tree.commit), params);
    const covered = (side: typeof tree): readonly string[] => [...new Set([...answer.paths, ...side.paths])];
    return {
      tree: { findings: answer.tree, covered: covered(tree) },
      base: { findings: answer.base, covered: covered(base) },
    };
  };

export const programs = (root: string) =>
  defineProgram<{ 'repeated-declarations': RepeatedParams; 'dead-code': DeadParams }>({
    'repeated-declarations': judged<RepeatedParams>(root, repeated),
    'dead-code': judged<DeadParams>(root, dead),
  });

export default programs(process.cwd());
