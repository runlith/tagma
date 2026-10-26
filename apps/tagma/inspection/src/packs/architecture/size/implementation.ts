import { METRICS, type Metrics } from '@runlith/code-facts/adapter';
import { UnsupportedLanguage } from '@runlith/code-facts/imports';
import { facetOf } from '@runlith/code-facts/tree';
import { matchesGlob } from 'node:path';
import type { Implementation } from '../../../core/node/reading';
import { localOf, picks } from '../../../core/node/select';
import type { Unjudged, Violation } from '../../../core/verdict';
import type { size as declared } from './declaration';

type Of = typeof declared.params.Type;

const MEASURES: { readonly [M in Of['thresholds'][number]['metric']]: (facts: Metrics) => number } = {
  'non-import': (facts) => facts.lines - facts.importLines,
};

const ceilingOf = (params: Of, local: string): Of['thresholds'][number] | undefined =>
  params.thresholds
    .filter(({ glob }) => matchesGlob(local, glob))
    .reduce<Of['thresholds'][number] | undefined>(
      (lowest, one) => (lowest === undefined || one.lines < lowest.lines ? one : lowest),
      undefined,
    );

const selects = (params: Of, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && picks(params.files, local) && ceilingOf(params, local) !== undefined;
};

export const size: Implementation<Of> = {
  facet: METRICS,
  lists: (params) => [params.base],
  selects,
  read: (params, tree, paths, adapters, budget) => {
    const violations: Violation[] = [];
    const unjudged: Unjudged[] = [];
    for (const path of [...new Set(paths.filter((one) => selects(params, one)))].sort()) {
      const local = localOf(params.base, path) ?? path;
      const threshold = ceilingOf(params, local);
      if (threshold === undefined) continue;
      budget.take(1, tree.size?.(path) ?? 0);
      let facts: Metrics;
      try {
        facts = facetOf(tree, path, METRICS, adapters);
      } catch (error) {
        if (!(error instanceof UnsupportedLanguage)) throw error;
        unjudged.push({ file: path, line: 1, specifier: `size: ${error.why}` });
        continue;
      }
      const value = MEASURES[threshold.metric](facts);
      if (value > threshold.lines) {
        violations.push({
          fingerprint: local,
          file: path,
          line: 1,
          message: `holds ${value} lines outside its imports, over ${threshold.lines}`,
          fix: `Move the code of another subject to the file that owns it until this one holds at most the ${threshold.lines} lines \`${threshold.glob}\` allows; split by named subjects, never by the count.`,
          value,
        });
      }
    }
    return { violations, unjudged };
  },
};
