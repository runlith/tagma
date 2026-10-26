import { declarationsOf } from './declarations';
import type { Literal } from './literals';

const HEX = /(?<![\w&-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

const EXACT = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})$/;

const FUNCTION = /(?<![\w-])(?:rgba?|hsla?|oklch)\(/g;

const NOT_COLOUR_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'xlink:href',
  'id',
  'for',
  'name',
  'src',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
]);

export const functionsIn = (text: string): readonly string[] =>
  [...text.matchAll(FUNCTION)].map((match) => {
    const close = text.indexOf(')', match.index);
    return text.slice(match.index, close < 0 ? undefined : close + 1).replace(/\s+/g, ' ');
  });

export const hexIn = (text: string): readonly string[] => [...text.matchAll(HEX)].map((match) => match[0]);

export const coloursOfValue = (value: string): readonly string[] => [...hexIn(value), ...functionsIn(value)];

export const coloursOfLiteral = (literal: Literal): readonly string[] => {
  const whole = literal.text.trim();
  const exact = EXACT.test(whole) && !NOT_COLOUR_ATTRIBUTES.has(literal.attribute) ? [whole] : [];
  const declared = declarationsOf(literal.text, literal.line).flatMap((one) => hexIn(one.value));
  return [...new Set([...exact, ...declared]), ...functionsIn(literal.text)];
};
