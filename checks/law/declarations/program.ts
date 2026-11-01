import { type Answer, defineProgram, type Finding, type InspectionInput } from '@runlith/tagma/rules';
import { isManifest, productionOf, type Reach } from './corpus';
import type { DeadParams, RepeatedParams } from './declaration';
import { dead, type Judge, repeated } from './gate';
import { changesBetween, indexedAt, prepare, WholeRequired } from './index';
import { sameReader } from '../store';

type Params = Reach & { readonly region: readonly string[] };

const WHOLE_KEPT = 4;

const wholes = new Map<string, readonly Finding[]>();

const judged =
  <P extends Params>(root: string, judge: Judge<P>) =>
  async (input: InspectionInput<P>): Promise<Answer> => {
    const { tree, base, params } = input;
    const reading = (findings: readonly Finding[]) => ({ findings, covered: 'reach' as const, remeasure: 'delta' as const });
    const wholeOf = (commit: string): readonly Finding[] => {
      const key = `${root}\0${judge.kind}\0${JSON.stringify(params)}\0${commit}`;
      const held = wholes.get(key);
      if (held !== undefined) return held;
      const found = judge.whole(root, commit, params);
      if (wholes.size >= WHOLE_KEPT) wholes.clear();
      wholes.set(key, found);
      return found;
    };
    if (
      tree.whole ||
      base === null ||
      base.whole ||
      (input.mode === 'measure' && (!sameReader(root, base.commit, tree.commit) || !indexedAt(root, base.commit)))
    ) {
      const found = wholeOf(tree.commit);
      if (found.length === 0 || base === null || input.mode === 'measure') return { tree: reading(found) };
      return { tree: reading(found), base: reading(wholeOf(base.commit)) };
    }
    const production = productionOf(params);
    if (![...tree.paths, ...base.paths].some((path) => production(path) || isManifest(path) || path.startsWith('.tagma/')))
      return { tree: { findings: [], covered: 'paths', remeasure: 'delta' } };
    let answer: ReturnType<Judge<P>['affected']>;
    try {
      prepare(root, tree.commit, base.commit);
      answer = judge.affected(root, base.commit, tree.commit, changesBetween(root, base.commit, tree.commit), params);
    } catch (error) {
      if (input.mode !== 'measure' || !(error instanceof WholeRequired)) throw error;
      return { tree: reading(wholeOf(tree.commit)) };
    }
    const covered = (side: typeof tree): readonly string[] => [...new Set([...answer.paths, ...side.paths])];
    return {
      tree: { findings: answer.tree, covered: covered(tree), remeasure: 'delta' },
      base: { findings: answer.base, covered: covered(base) },
    };
  };

export const programs = (root: string) =>
  defineProgram<{ 'repeated-declarations': RepeatedParams; 'dead-code': DeadParams }>({
    'repeated-declarations': judged<RepeatedParams>(root, repeated),
    'dead-code': judged<DeadParams>(root, dead),
  });

export default programs(process.cwd());
