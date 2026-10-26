import type { LazyLocaleBundle, LazyLocaleLoader, LocaleBundle, LocaleCode, LocaleKey, LocaleMessages, LocaleParams } from './types.js';

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

import { type LocaleReader, resolveLocale } from './locale.js';
import { type MessageNode, parseMessage, renderMessage } from './message-format.js';

export interface I18nOptions {
  locale?: LocaleCode;
  fallbackLocale?: LocaleCode;
  bundles?: LocaleBundle[];
  lazyBundles?: LazyLocaleBundle[];
}

export interface I18nLocaleSource {
  readonly read: LocaleReader;
  readonly supported: readonly LocaleCode[];
  readonly default: LocaleCode;
}

export type I18nRecipe = Omit<I18nOptions, 'locale'> & { readonly locale: I18nLocaleSource };

export class I18n extends Service<I18n>()('I18n', { tier: 'app' }) {
  static of(recipe: I18nRecipe) {
    return Layer.provide(I18n, function* () {
      const platform = yield* Platform;
      const locale = resolveLocale({
        chosen: recipe.locale.read(platform),
        languages: platform.languages,
        supportedLocales: recipe.locale.supported,
        defaultLocale: recipe.locale.default,
      });
      return new I18n({ ...recipe, locale });
    });
  }

  locale = $state<LocaleCode>('en');
  fallbackLocale = $state<LocaleCode>('en');

  private revision = $state(0);
  private messagesByLocale: Record<LocaleCode, LocaleMessages> = {};
  private lazyBundles: LazyLocaleBundle[] = [];
  private lazyLoadedLocales = new SvelteSet<LocaleCode>();
  private lazyLoadInFlight = new SvelteMap<LocaleCode, Promise<void>>();

  private parsed = new Map<string, MessageNode[] | null>();
  private pluralRules = new Map<string, Intl.PluralRules>();
  private numberFormats = new Map<LocaleCode, Intl.NumberFormat>();

  constructor(options: I18nOptions = {}) {
    super();
    this.locale = options.locale ?? 'en';
    this.fallbackLocale = options.fallbackLocale ?? this.locale;

    for (const bundle of options.bundles ?? []) {
      this.register(bundle);
    }

    for (const bundle of options.lazyBundles ?? []) {
      this.registerLazy(bundle);
    }
  }

  register(bundle: LocaleBundle): void {
    for (const [locale, messages] of Object.entries(bundle)) {
      const current = this.messagesByLocale[locale] ?? {};
      this.messagesByLocale[locale] = { ...current, ...messages };
    }

    this.revision += 1;
  }

  registerLazy(bundle: LazyLocaleBundle): void {
    this.lazyBundles.push(bundle);
  }

  async loadLocale(locale: LocaleCode): Promise<void> {
    if (this.lazyLoadedLocales.has(locale)) return;

    const inFlight = this.lazyLoadInFlight.get(locale);
    if (inFlight) {
      await inFlight;
      return;
    }

    const promise = this.loadLocaleInternal(locale);
    this.lazyLoadInFlight.set(locale, promise);

    try {
      await promise;
    } finally {
      this.lazyLoadedLocales.add(locale);
      this.lazyLoadInFlight.delete(locale);
    }
  }

  async changeLocale(next: LocaleCode): Promise<void> {
    if (!next || next === this.locale) return;

    await this.loadLocale(next);
    this.locale = next;
  }

  private async loadLocaleInternal(locale: LocaleCode): Promise<void> {
    const loaders: Array<{ index: number; loader: LazyLocaleLoader }> = [];

    for (let index = 0; index < this.lazyBundles.length; index += 1) {
      const loader = this.lazyBundles[index]?.[locale];
      if (typeof loader === 'function') {
        loaders.push({ index, loader });
      }
    }

    if (loaders.length === 0) return;

    const results = await Promise.all(
      loaders.map(async ({ index, loader }) => {
        try {
          const messages = await loader();
          return { index, messages };
        } catch {
          return { index, messages: undefined };
        }
      }),
    );

    results.sort((a, b) => a.index - b.index);

    let changed = false;
    for (const { messages } of results) {
      if (!messages) continue;

      const current = this.messagesByLocale[locale] ?? {};
      this.messagesByLocale[locale] = { ...current, ...messages };
      changed = true;
    }

    if (changed) {
      this.revision += 1;
    }
  }

  translate = <T extends LocaleKey | undefined>(token: T, fallback?: T, args: Record<string | number, unknown> = {}): T => {
    if (token === undefined) {
      return undefined as T;
    }

    String(this.revision);

    const primary = this.messagesByLocale[this.locale];
    const fallbackMessages = this.locale === this.fallbackLocale ? undefined : this.messagesByLocale[this.fallbackLocale];

    let translation = primary?.[token] ?? fallbackMessages?.[token];

    if (typeof translation === 'string') {
      return this.format(translation, args, (name) => {
        const alias = name.startsWith('alias:') ? name.slice('alias:'.length) : undefined;
        return alias ? this.translate(alias as LocaleKey) : `{${name}}`;
      }) as T;
    }

    if (fallback !== undefined) {
      return this.translate(fallback);
    }

    return token;
  };

  t = (key: LocaleKey, params?: LocaleParams): string => {
    return this.translate(key, undefined, params ?? {}) ?? key;
  };

  interpolate = <T extends string | undefined>(template: T, args: Record<string | number, unknown> = {}, fallback?: T): T => {
    if (template === undefined) {
      return undefined as T;
    }

    if (!template) return '' as T;

    const hasInterpolationTemplates = /{([^{}:]+)}/g.test(template);
    if (!hasInterpolationTemplates) {
      return this.translate(template as LocaleKey, fallback as LocaleKey | undefined, args) as T;
    }

    return this.format(template, args, (name) => {
      const translation = this.translate(name as LocaleKey);
      return translation !== name ? translation : `{${name}}`;
    }) as T;
  };

  private format(template: string, params: Record<string | number, unknown>, resolveMissing: (name: string) => string): string {
    const nodes = this.parse(template);
    if (!nodes) return template;

    return renderMessage(nodes, {
      params: params as Record<string, unknown>,
      resolveMissing,
      selectPluralCategory: (value, type) => this.rules(type).select(value),
      formatNumber: (value) => this.numberFormat().format(value),
    });
  }

  private parse(template: string): MessageNode[] | undefined {
    const cached = this.parsed.get(template);
    if (cached !== undefined) return cached ?? undefined;

    try {
      const nodes = parseMessage(template);
      this.parsed.set(template, nodes);
      return nodes;
    } catch {
      this.parsed.set(template, null);
      return undefined;
    }
  }

  private rules(type: 'cardinal' | 'ordinal'): Intl.PluralRules {
    const key = `${this.locale}:${type}`;
    const cached = this.pluralRules.get(key);
    if (cached) return cached;

    const rules = new Intl.PluralRules(this.locale, { type });
    this.pluralRules.set(key, rules);
    return rules;
  }

  private numberFormat(): Intl.NumberFormat {
    const cached = this.numberFormats.get(this.locale);
    if (cached) return cached;

    const format = new Intl.NumberFormat(this.locale);
    this.numberFormats.set(this.locale, format);
    return format;
  }
}
