import { I18n } from './I18n.svelte.js';
import type { LocaleCode, LocaleMessages } from './types.js';

export function makeI18n(options?: { locale?: LocaleCode; messages?: LocaleMessages }): I18n {
  const locale = options?.locale ?? 'ru';
  return new I18n({
    locale,
    bundles: options?.messages ? [{ [locale]: options.messages }] : [],
  });
}
