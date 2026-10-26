import type { Adapters } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import { bare, inRegion } from '../../../core/params';
import type { Unjudged, Violation } from '../../../core/verdict';
import type { Budget } from '../../../core/node/budget';
import { type Checked, checkedOnce, type InspectionMemo, objectsOf, validMemo } from '../../../core/node/memo';
import type { Implementation, ReadingScope } from '../../../core/node/reading';
import { localOf, mentionedIn, picks } from '../../../core/node/select';
import { ABSENCE_FORMS, allowanceKey, FORMS, type SwallowedFailuresParams } from './declaration';
import { type Site, sitesIn } from './sites';

const selects = (params: SwallowedFailuresParams, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && inRegion(params, path) && picks(params.files, local);
};

const MEMO = 'swallowed-failures/recovery-shape';

const memoKey = (path: string): string => `${MEMO}\0${path}`;

const LINE = /^(\d+) (\S+) (\S+) ([01]) ([0-9a-f]{8})$/;

const packed = (sites: readonly Site[]): readonly Violation[] =>
  sites.map((one) => ({
    fingerprint: `${one.line} ${one.symbol} ${one.form} ${one.judged ? 1 : 0} ${one.site}`,
    file: '',
    line: one.line,
  }));

const unpacked = (held: readonly Violation[]): readonly Site[] | undefined => {
  const sites: Site[] = [];
  for (const one of held) {
    const match = LINE.exec(one.fingerprint);
    if (match === null || !(FORMS as readonly string[]).includes(match[3] as string)) return undefined;
    sites.push({
      line: Number(match[1]),
      symbol: match[2] as string,
      form: match[3] as Site['form'],
      judged: match[4] === '1',
      site: match[5] as string,
    });
  }
  return sites;
};

const sitesOf = (tree: Tree, path: string, memo: InspectionMemo | undefined, checked: Checked): readonly Site[] => {
  const key = memoKey(path);
  if (memo !== undefined && validMemo(key, objectsOf(tree), () => '', memo, checked)) {
    const held = memo.get(key);
    const sites = held === undefined ? undefined : unpacked(held.violations);
    if (sites !== undefined) return sites;
  }
  const sites = sitesIn(path, tree.read(path));
  if (memo !== undefined && tree.object !== undefined) {
    memo.set(key, { dependencies: [[path, tree.object(path) ?? null]], listings: [], violations: packed(sites), read: [] });
  }
  return sites;
};

const WORDS = [...FORMS, '_tag', 'isSuccess', 'isFailure', 'isLeft', 'isRight', 'isNone', 'isSome'];

const isAbsence = (form: string): boolean => (ABSENCE_FORMS as readonly string[]).includes(form);

const specifierOf = (form: string): string => (isAbsence(form) ? form : `Effect.${form}`);

const messageOf = (site: Site): string =>
  `${
    isAbsence(site.form)
      ? `\`${site.form}\` answers failure with a success value`
      : site.form === 'ignore' || site.form === 'ignoreCause'
        ? `\`Effect.${site.form}\` discards every failure`
        : site.form === 'orElseSucceed'
          ? '`Effect.orElseSucceed` answers every failure with a success'
          : site.form === 'catch' || site.form === 'catchEager' || site.form === 'catchCause'
            ? `\`Effect.${site.form}\` recovers every failure with a success`
            : `\`Effect.${site.form}\` recovers every other failure with a success through its fallback`
  } (site ${site.site})`;

const fixOf = (local: string, site: Site): string =>
  `${
    isAbsence(site.form)
      ? 'Answer the failure by its condition: re-fail, keep the Result, or carry the failure into the answer.'
      : 'Recover only the expected tags — `Effect.catchTag` or `catchTags` with no fallback — and let the rest fail.'
  } Where discarding it is the intent, add \`{ path: '${local}', symbol: '${site.symbol}', form: '${site.form}', site: '${site.site}', why: '…' }\` to \`allow\`.`;

const read = (
  params: SwallowedFailuresParams,
  tree: Tree,
  paths: readonly string[],
  _adapters: Adapters,
  budget: Budget,
  memo?: InspectionMemo,
  scope: ReadingScope = 'reach',
) => {
  const allowed = new Set(params.allow.map(allowanceKey));
  const violations: Violation[] = [];
  const unjudged: Unjudged[] = [];
  const selected = [...new Set(paths)].filter((path) => tree.has(path) && selects(params, path)).sort();
  const mentioned = mentionedIn(tree, selected, WORDS, scope);
  const touched = mentioned === undefined ? selected : selected.filter((path) => mentioned.has(path));
  const checked = checkedOnce();
  for (const path of touched) {
    budget.take(1, tree.size?.(path) ?? 0);
    const local = localOf(params.base, path) ?? path;
    const seen = new Map<string, number>();
    for (const site of sitesOf(tree, path, memo, checked)) {
      if (allowed.has(allowanceKey({ path: local, symbol: site.symbol, form: site.form, site: site.site }))) continue;
      if (!site.judged) {
        unjudged.push({ file: path, line: site.line, specifier: `${specifierOf(site.form)} ${site.symbol} ${site.site}` });
        continue;
      }
      const named = `${local} ${site.symbol} ${site.form} ${site.site}`;
      const count = (seen.get(named) ?? 0) + 1;
      seen.set(named, count);
      violations.push({
        fingerprint: count === 1 ? named : `${named}#${count}`,
        file: path,
        line: site.line,
        specifier: specifierOf(site.form),
        message: messageOf(site),
        fix: fixOf(local, site),
      });
    }
  }
  return { violations, unjudged };
};

export const swallowedFailures: Implementation<SwallowedFailuresParams> = {
  lists: (params: SwallowedFailuresParams) => params.region.map((one) => (params.base === '' ? bare(one) : `${params.base}/${bare(one)}`)),
  selects,
  read,
  prefetch: false,
};
