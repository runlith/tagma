import { LANGUAGES, type LanguageId } from '@runlith/code-facts/languages';

export type Languages = 'any' | readonly LanguageId[];

export const extensionsOf = (languages: Languages): readonly string[] =>
  LANGUAGES.filter(({ id }) => languages === 'any' || languages.includes(id)).flatMap(({ extensions }) => extensions);

export const idsOf = (languages: Languages): readonly LanguageId[] =>
  LANGUAGES.filter(({ id }) => languages === 'any' || languages.includes(id)).map(({ id }) => id);
