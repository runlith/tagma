import { declarationIssues } from './declarations';
import type { Literal } from './literals';
import type { UiTokensParams } from './declaration';
import { caseIssue, stateBackgroundIssue } from './states';

type Allow = UiTokensParams['allow'];

export type Finding = { readonly token: string; readonly line: number; readonly message: string };

export type Token = { readonly token: string; readonly utility: string; readonly variants: readonly string[]; readonly line: number };

const SIZES = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']);

const TEXT_OTHER = new Set([
  'left',
  'center',
  'right',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  'transparent',
  'current',
  'inherit',
]);

const BARE = new Set([
  'block',
  'inline',
  'flex',
  'grid',
  'hidden',
  'contents',
  'table',
  'static',
  'fixed',
  'absolute',
  'relative',
  'sticky',
  'visible',
  'invisible',
  'collapse',
  'uppercase',
  'lowercase',
  'capitalize',
  'italic',
  'underline',
  'overline',
  'truncate',
  'antialiased',
  'grow',
  'shrink',
  'border',
  'ring',
  'outline',
  'rounded',
  'shadow',
  'transition',
  'container',
  'isolate',
  'group',
  'peer',
  'resize',
  'transform',
  'filter',
  'blur',
]);

const ROUNDED = /^rounded(?:-(tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e))?(?:-(.+))?$/;

const SPACING = /^(px|py|pt|pr|pb|pl|ps|pe|p|mx|my|mt|mr|mb|ml|ms|me|m|gap-x|gap-y|gap|space-x|space-y)-(.*)$/;

const COMPOSED =
  /^(?:text|rounded(?:-(?:tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e))?|shadow|px|py|pt|pr|pb|pl|ps|pe|p|mx|my|mt|mr|mb|ml|ms|me|m|gap-x|gap-y|gap|space-x|space-y|size)-$/;

const PALETTE =
  /^(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide(?:-[xy])?|accent|caret|decoration|placeholder|shadow)-(?:(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}|black|white)(?:\/.*)?$/;

const PROPERTY = /^\[([a-z-]+):(.*)\]$/;

const TRIM_START = /^[{('"`]+/;

const TRIM_END = /[})'"`,;]+$/;

const splitToken = (token: string): { readonly variants: readonly string[]; readonly utility: string } => {
  const variants: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < token.length; at++) {
    const c = token[at]!;
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) {
      variants.push(token.slice(from, at));
      from = at + 1;
    }
  }
  return {
    variants,
    utility: token
      .slice(from)
      .replace(/^!|!$/g, '')
      .replace(/^-(?=[a-z])/, ''),
  };
};

export const tokensOf = (literal: Literal): readonly Token[] => {
  const tokens: Token[] = [];
  for (const match of literal.text.matchAll(/\S+/g)) {
    const token = match[0].replace(TRIM_START, '').replace(TRIM_END, '');
    if (token === '' || token.includes('${') || token.includes('{')) continue;
    const line = literal.line + (literal.text.slice(0, match.index).match(/\n/g)?.length ?? 0);
    tokens.push({ token, ...splitToken(token), line });
  }
  return tokens;
};

const shaped = (token: string): boolean => {
  if (token.includes('//')) return false;
  if (!/[-:/[]/.test(token)) return BARE.has(token);
  return /^[!@a-z0-9_:.,%#~+*&>=()/'"-]+$/.test(token.replace(/\[[^\]]*\]/g, 'x').replace(/\([^)]*\)/g, 'x'));
};

const nameOf = (rest: string): string => (rest.startsWith('[') || rest.startsWith('(') ? rest : rest.replace(/\/[\w.]+$/, ''));

const arbitrary = (name: string): boolean => name.startsWith('[') || name.startsWith('(');

const outside = (family: string, name: string, allowed: readonly string[]): string =>
  arbitrary(name)
    ? `an arbitrary ${family} value is outside the standard`
    : `\`${name}\` is outside the standard ${family} names (${allowed.join(', ')})`;

const judged = (token: Token, bare: boolean, allow: Allow, casing: boolean): string | undefined => {
  const { utility } = token;
  if (COMPOSED.test(utility)) return `\`${utility}\` is a composed class name that cannot be generated; write the whole class`;
  if (PALETTE.test(utility)) return `Tailwind palette colour \`${utility}\` is outside the colour tokens`;
  const state = stateBackgroundIssue(token, allow.stateBackgrounds);
  if (state !== undefined) return state;
  if (casing) {
    const issue = caseIssue(utility, bare);
    if (issue !== undefined) return issue;
  }
  const property = PROPERTY.exec(utility);
  if (property !== null) {
    return declarationIssues(property[1]!, property[2]!.replace(/_/g, ' '))[0];
  }
  if (utility.startsWith('text-')) {
    const name = nameOf(utility.slice(5));
    if (arbitrary(name) || SIZES.has(name)) return outside('text', name, allow.text);
    if (allow.text.includes(name) || allow.textColors.includes(name) || TEXT_OTHER.has(name)) return undefined;
    return `\`text-${name}\` is not a standard size, colour token or text utility`;
  }
  if (utility === 'rounded' || utility.startsWith('rounded-')) {
    if (utility === 'rounded' && !bare) return undefined;
    const match = ROUNDED.exec(utility);
    if (match === null) return outside('rounded', utility, allow.rounded);
    const name = nameOf(match[2] ?? '');
    return allow.rounded.includes(name) ? undefined : outside('rounded', name === '' ? 'a bare radius' : name, allow.rounded);
  }
  if (utility === 'shadow' || utility.startsWith('shadow-')) {
    if (utility === 'shadow' && !bare) return undefined;
    const name = nameOf(utility.slice(7));
    return allow.shadow.includes(name) ? undefined : outside('shadow', name === '' ? 'a bare shadow' : name, allow.shadow);
  }
  const spacing = SPACING.exec(utility);
  if (spacing !== null) {
    const name = nameOf(spacing[2]!);
    return allow.spacing.includes(name) ? undefined : outside('spacing', name, allow.spacing);
  }
  if (utility.startsWith('size-[') || utility.startsWith('size-(')) return outside('icon size', nameOf(utility.slice(5)), allow.icon);
  return undefined;
};

export const judgeLiteral = (literal: Literal, allow: Allow, casing: boolean): readonly Finding[] => {
  const tokens = tokensOf(literal);
  if (!literal.classes && !tokens.every((one) => shaped(one.token))) return [];
  const bare = literal.classes || tokens.length >= 2;
  return tokens.flatMap((one) => {
    const message = judged(one, bare, allow, casing);
    return message === undefined ? [] : [{ token: one.token, line: one.line, message }];
  });
};

export const sizesOf = (literals: readonly Literal[]): readonly Token[] =>
  literals
    .filter((one) => one.classes)
    .flatMap(tokensOf)
    .filter((one) => one.utility.startsWith('size-'));
