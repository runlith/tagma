const names = new Intl.DisplayNames(['en'], { type: 'language' });

export const languageName = (tag: string): string => names.of(tag) ?? tag;

const WIDELY = [
  'ar',
  'bn',
  'zh-Hans',
  'zh-Hant',
  'cs',
  'nl',
  'en',
  'fr',
  'de',
  'el',
  'he',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'fa',
  'pl',
  'pt-BR',
  'pt-PT',
  'ru',
  'es',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
] as const;

export const widelyUsed: readonly { readonly tag: string; readonly name: string }[] = WIDELY.map((tag) => ({
  tag,
  name: languageName(tag),
})).sort((a, b) => a.name.localeCompare(b.name, 'en'));

export const systemLanguage = (languages: readonly string[]): string => new Intl.Locale(languages[0] ?? 'en').language;
