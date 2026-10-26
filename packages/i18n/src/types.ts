export type LocaleCode = string;

declare const i18nKeyRegistryBrand: unique symbol;

export interface I18nKeyRegistry {
  readonly [i18nKeyRegistryBrand]?: never;
}

type KnownLocaleKey = Extract<keyof I18nKeyRegistry, string>;
export type LocaleKey = [KnownLocaleKey] extends [never] ? string : KnownLocaleKey;

export type LocaleMessages = Partial<Record<LocaleKey, string>>;

export type LocaleBundle = Record<LocaleCode, LocaleMessages>;

export type LocaleParams = Record<string, string | number>;

export type LazyLocaleLoader = () => Promise<LocaleMessages>;
export type LazyLocaleBundle = Record<LocaleCode, LazyLocaleLoader>;
