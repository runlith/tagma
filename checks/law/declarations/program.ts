import { type Answer, defineProgram, type Finding, type InspectionInput } from '@runlith/tagma/rules';
import { type Corpus, productionOf, type Reach } from './corpus';
import { findDead } from './dead';
import type { DeadParams, RepeatedParams } from './declaration';
import { deadAt, repeatedAt, wholeAt, type Which } from './gate';
import { type Change, changesBetween, prepare } from './index';
import { findRepeated } from './repeated';

type Params = Reach & { readonly region: readonly string[] };

type Judge<P extends Params> = {
  readonly whole: (corpus: Corpus, params: P) => readonly Finding[];
  readonly changed: (root: string, commit: string, changes: readonly Change[], which: Which, params: P) => readonly Finding[];
};

const differences = new Map<string, readonly Change[]>();

const between = (root: string, base: string, tree: string): readonly Change[] => {
  const key = `${root}\0${base}\0${tree}`;
  const held = differences.get(key);
  if (held !== undefined) return held;
  const found = changesBetween(root, base, tree);
  differences.set(key, found);
  return found;
};

const judged =
  <P extends Params>(root: string, judge: Judge<P>) =>
  async (input: InspectionInput<P>): Promise<Answer> => {
    const { tree, base, params } = input;
    if (tree.whole || base === null || base.whole) {
      const found = judge.whole(wholeAt(root, tree.commit, params.tests), params);
      if (found.length === 0 || base === null) return { tree: { findings: found, covered: 'reach' } };
      return {
        tree: { findings: found, covered: 'reach' },
        base: { findings: judge.whole(wholeAt(root, base.commit, params.tests), params), covered: 'reach' },
      };
    }
    const production = productionOf(params);
    const touched = [...tree.paths, ...base.paths].some((path) => production(path) && params.region.some((one) => path.startsWith(one)));
    if (!touched) return { tree: { findings: [], covered: 'paths' } };
    prepare(root, tree.commit, base.commit);
    const changes = between(root, base.commit, tree.commit);
    const found = judge.changed(root, tree.commit, changes, 'after', params);
    if (found.length === 0) return { tree: { findings: [], covered: 'paths' } };
    const standing = new Set(found.map((one) => one.path));
    return {
      tree: { findings: found, covered: 'paths' },
      base: {
        findings: judge.changed(
          root,
          base.commit,
          changes.filter((one) => standing.has(one.path)),
          'before',
          params,
        ),
        covered: 'paths',
      },
    };
  };

export const programs = (root: string) =>
  defineProgram<{ 'repeated-declarations': RepeatedParams; 'dead-code': DeadParams }>({
    'repeated-declarations': judged<RepeatedParams>(root, { whole: findRepeated, changed: repeatedAt }),
    'dead-code': judged<DeadParams>(root, { whole: (corpus, params) => findDead(corpus, params), changed: deadAt }),
  });

export default programs(process.cwd());
