import type { Token } from './classes';

const STATE =
  /^(?:(?:group|peer)(?:\/[\w-]+)?-)?(?:hover|data-highlighted|data-selected|data-open|data-\[(?:highlighted|selected|state=open)(?:=true)?\]|aria-selected|aria-\[selected=true\])$/;

const ARBITRARY_STATE = /^\[.*(?::hover|data-highlighted|data-selected|aria-selected|data-state=open).*\]$/;

const NOT_BACKGROUND =
  /^bg-(?:none|auto|cover|contain|center|top|bottom|left|right|(?:left|right|top|bottom)-(?:top|bottom|left|right)|(?:no-)?repeat(?:-.+)?|fixed|local|scroll|(?:gradient|linear|radial|conic|clip|origin|blend|size|position)(?:-.+)?)$/;

const BACKGROUND_PROPERTY = /^\[background(?:-color)?:/;

const TRACKING = /^tracking-(?:tighter|tight|normal|wide|wider|widest|\[.*\]|\(.*\))$/;

const RESET = /^(?:normal|inherit|initial|unset|revert|0(?:\.0+)?(?:px|em|rem)?)$/;

const stateful = (variants: readonly string[]): boolean => variants.some((one) => STATE.test(one) || ARBITRARY_STATE.test(one));

const sets = (utility: string): boolean =>
  BACKGROUND_PROPERTY.test(utility) || (utility.startsWith('bg-') && !NOT_BACKGROUND.test(utility));

export const stateBackgroundIssue = (token: Token, allowed: readonly string[] | undefined): string | undefined => {
  if (allowed === undefined || !stateful(token.variants) || !sets(token.utility)) return undefined;
  if (token.utility.startsWith('bg-') && allowed.includes(token.utility.slice(3))) return undefined;
  return `\`${token.token}\` sets a background in a state variant; only ${allowed.map((one) => `bg-${one}`).join(', ')} are allowed`;
};

export const caseIssue = (utility: string, bare: boolean): string | undefined => {
  if (utility === 'uppercase' && bare) return '`uppercase` is outside the standard; section labels use the normal case';
  if (TRACKING.test(utility)) return `\`${utility}\` is outside the standard; letter spacing is not used`;
  return undefined;
};

export const caseDeclarationIssue = (property: string, value: string): string | undefined => {
  if (property === 'text-transform' && /\buppercase\b/i.test(value))
    return '`text-transform: uppercase` is outside the standard; section labels use the normal case';
  if (property === 'letter-spacing' && !RESET.test(value))
    return `\`letter-spacing: ${value}\` is outside the standard; letter spacing is not used`;
  return undefined;
};
