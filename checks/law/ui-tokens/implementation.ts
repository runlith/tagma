import type { Implementation } from '@tagma/inspection/node/reading';
import type { Violation } from '@tagma/inspection/verdict';
import { unitsOf } from '@tagma/inspection/verdict';
import { inRegion } from '../params';
import { localOf, picks } from '../select';
import { judgeLiteral, sizesOf } from './classes';
import { coloursOfLiteral, coloursOfValue } from './colours';
import { declarationIssues, declarationsOf, withoutComments } from './declarations';
import { casingJudged, literalsAt, type UiTokensParams } from './declaration';
import { caseDeclarationIssue } from './states';
import { iconNamesOf, type Literal, sourceOf } from './literals';

const selects = (params: UiTokensParams, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && inRegion(params, path) && picks(params.files, local);
};

const APPLY = /@apply\s+([^;}]+)/g;

const lineAt = (text: string, index: number, first: number): number => first + (text.slice(0, index).match(/\n/g)?.length ?? 0);

const applied = (text: string, first: number): readonly Literal[] =>
  [...text.matchAll(APPLY)].map((match) => ({
    text: match[1]!,
    line: lineAt(text, match.index, first),
    classes: true,
    style: false,
    attribute: '@apply',
  }));

type Found = { readonly key: string; readonly line: number; readonly message: string };

type Sheet = { readonly text: string; readonly line: number };

const colourFound = (value: string, line: number): Found => ({
  key: `colour ${value}`,
  line,
  message: `colour literal \`${value}\` is outside the token files and palettes`,
});

const judgeSheet = (sheet: Sheet): readonly Found[] =>
  declarationsOf(sheet.text, sheet.line).flatMap((one) => {
    const issues = declarationIssues(one.property, one.value);
    return [
      ...(issues.length === 0 ? [] : [{ key: `${one.property}: ${one.value}`, line: one.line, message: issues.join('; ') }]),
      ...coloursOfValue(one.value).map((value) => colourFound(value, one.line)),
    ];
  });

const judgeCase = (sheet: Sheet): readonly Found[] =>
  declarationsOf(sheet.text, sheet.line).flatMap((one) => {
    const message = caseDeclarationIssue(one.property, one.value);
    return message === undefined ? [] : [{ key: `${one.property}: ${one.value}`, line: one.line, message }];
  });

const judgeFile = (params: UiTokensParams, local: string, text: string): readonly Found[] => {
  const found: Found[] = [];
  const css = local.endsWith('.css');
  const svelte = local.endsWith('.svelte');
  const source = css
    ? { literals: [], styles: [{ text, line: 1 }], icons: [] }
    : sourceOf(text, svelte, svelte ? iconNamesOf(text, params.icons) : new Set());
  const sheets: readonly Sheet[] = source.styles.map((one) => ({ text: withoutComments(one.text), line: one.line }));
  const literals = [...source.literals.filter((one) => !one.style), ...sheets.flatMap((one) => applied(one.text, one.line))];
  for (const literal of literals) {
    for (const one of judgeLiteral(literal, params.allow, casingJudged(params, local)))
      found.push({ key: one.token, line: one.line, message: one.message });
  }
  for (const icon of source.icons) {
    const sizes = sizesOf(icon.literals);
    if (sizes.length === 0)
      found.push({
        key: `icon ${icon.name}`,
        line: icon.line,
        message: `icon \`${icon.name}\` has no explicit size class (${params.allow.icon.join(', ')})`,
      });
    for (const size of sizes) {
      const step = size.utility.slice(5);
      if (!size.utility.startsWith('size-[') && !params.allow.icon.includes(step)) {
        found.push({
          key: `icon ${icon.name} ${size.token}`,
          line: size.line,
          message: `icon size \`${step}\` is outside the standard icon sizes (${params.allow.icon.join(', ')})`,
        });
      }
    }
  }
  const inline = source.literals.filter((one) => one.style).map((one) => ({ text: one.text, line: one.line }));
  if (casingJudged(params, local)) {
    for (const sheet of [...sheets, ...inline]) found.push(...judgeCase(sheet));
  }
  if (!literalsAt(params, local)) {
    for (const sheet of [...sheets, ...inline]) found.push(...judgeSheet(sheet));
    for (const literal of source.literals.filter((one) => !one.style)) {
      for (const value of coloursOfLiteral(literal)) found.push(colourFound(value, literal.line));
    }
    for (const literal of literals.filter((one) => one.attribute === '@apply')) {
      for (const value of coloursOfValue(literal.text)) found.push(colourFound(value, literal.line));
    }
  }
  return found;
};

const read: Implementation<UiTokensParams>['read'] = (params, tree, paths) => ({
  violations: unitsOf(
    paths.flatMap((path): readonly Violation[] => {
      const local = localOf(params.base, path);
      if (local === undefined || !selects(params, path)) return [];
      const seen = new Map<string, number>();
      return judgeFile(params, local, tree.read(path)).map((one) => {
        const count = (seen.get(one.key) ?? 0) + 1;
        seen.set(one.key, count);
        return { fingerprint: `${local} ${one.key}${count === 1 ? '' : ` #${count}`}`, file: path, line: one.line, message: one.message };
      });
    }),
  ),
  unjudged: [],
});

export const uiTokens: Implementation<UiTokensParams> = {
  lists: (params) => [params.base],
  selects,
  read,
};
