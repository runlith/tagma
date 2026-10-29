import { Schema } from 'effect';

const isLanguageTag = (tag: string): boolean => {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
};

export const LANGUAGE_TAG = Schema.String.check(Schema.makeFilter(isLanguageTag)).annotate({
  description: 'A BCP 47 language tag, such as `ru` or `pt-BR`.',
});
