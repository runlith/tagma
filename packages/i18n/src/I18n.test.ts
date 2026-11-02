import { describe, expect, test } from 'vitest';
import { makeCookies, makePlatform, makeStorage } from '@runlith/layer/testing';

import { I18n } from './I18n.svelte.js';
import { cookieLocale, resolveLocale, storedLocale } from './locale.js';

describe('I18n', () => {
  test('returns key when translation is missing', () => {
    const i18n = new I18n({ locale: 'en' });
    expect(i18n.t('missing.key')).toBe('missing.key');
  });

  test('uses primary locale messages', () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: {
            'banner.title': 'Hello',
          },
        },
      ],
    });

    expect(i18n.t('banner.title')).toBe('Hello');
  });

  test('falls back to fallbackLocale', () => {
    const i18n = new I18n({
      locale: 'ru',
      fallbackLocale: 'en',
      bundles: [
        {
          en: {
            'banner.title': 'Hello',
          },
        },
      ],
    });

    expect(i18n.t('banner.title')).toBe('Hello');
  });

  test('register merges bundles and overrides existing keys', () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: {
            'x.a': 'A1',
            'x.b': 'B1',
          },
        },
      ],
    });

    i18n.register({
      en: {
        'x.b': 'B2',
        'x.c': 'C2',
      },
    });

    expect(i18n.t('x.a')).toBe('A1');
    expect(i18n.t('x.b')).toBe('B2');
    expect(i18n.t('x.c')).toBe('C2');
  });

  test('supports simple params interpolation', () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: {
            'greet.user': 'Hello {name}, you have {count} messages',
            'greet.with-alias': 'Hello {alias:appName}!',
            appName: 'Acme',
          },
        },
      ],
    });

    expect(i18n.t('greet.user', { name: 'Teun', count: 3 })).toBe('Hello Teun, you have 3 messages');
    expect(i18n.t('greet.with-alias')).toBe('Hello Acme!');
  });

  test('interpolate translates a plain key when no {..} templates are present', () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: {
            'bonus.deactivated': 'Bonus deactivated',
          },
        },
      ],
    });

    expect(i18n.interpolate('bonus.deactivated')).toBe('Bonus deactivated');
  });

  test('interpolate replaces placeholders with provided args', () => {
    const i18n = new I18n({ locale: 'en' });
    expect(i18n.interpolate('Hello {name}!', { name: 'Teun' })).toBe('Hello Teun!');
    expect(i18n.interpolate('Value: {x} {y}', { x: 1 })).toBe('Value: 1 {y}');
  });

  test('interpolate translates placeholders when args are missing', () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: {
            'model.reward.bonus.fs': 'Bonus Points',
          },
        },
      ],
    });

    expect(i18n.interpolate('10 {model.reward.bonus.fs}')).toBe('10 Bonus Points');
  });

  test('interpolate keeps placeholder when translation is missing', () => {
    const i18n = new I18n({ locale: 'en' });
    expect(i18n.interpolate('10 {unknown.key}')).toBe('10 {unknown.key}');
  });

  test('translate uses fallback token when primary is missing', () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: {
            'fallback.key': 'Fallback value',
          },
        },
      ],
    });

    expect(i18n.translate('missing.key', 'fallback.key')).toBe('Fallback value');
  });

  test('lazy loadLocale loads only requested locale', async () => {
    let enLoads = 0;
    let ruLoads = 0;

    const i18n = new I18n({
      locale: 'en',
      lazyBundles: [
        {
          en: async () => {
            enLoads += 1;
            return { hello: 'Hello' };
          },
          ru: async () => {
            ruLoads += 1;
            return { hello: 'Привет' };
          },
        },
      ],
    });

    await i18n.loadLocale('en');
    expect(enLoads).toBe(1);
    expect(ruLoads).toBe(0);
    expect(i18n.t('hello')).toBe('Hello');

    await i18n.loadLocale('en');
    expect(enLoads).toBe(1);
    expect(ruLoads).toBe(0);

    await i18n.loadLocale('ru');
    expect(enLoads).toBe(1);
    expect(ruLoads).toBe(1);
  });

  test('lazy changeLocale loads messages before switching locale', async () => {
    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: { hello: 'Hello' },
        },
      ],
      lazyBundles: [
        {
          ru: async () => ({ hello: 'Привет' }),
        },
      ],
    });

    expect(i18n.locale).toBe('en');
    expect(i18n.t('hello')).toBe('Hello');

    await i18n.changeLocale('ru');
    expect(i18n.locale).toBe('ru');
    expect(i18n.t('hello')).toBe('Привет');
  });

  test('lazy loadLocale merges bundles in registration order', async () => {
    const i18n = new I18n({
      locale: 'ru',
      lazyBundles: [
        {
          ru: async () => ({
            a: 'A1',
            b: 'B1',
          }),
        },
        {
          ru: async () => ({
            b: 'B2',
            c: 'C2',
          }),
        },
      ],
    });

    await i18n.loadLocale('ru');
    expect(i18n.t('a')).toBe('A1');
    expect(i18n.t('b')).toBe('B2');
    expect(i18n.t('c')).toBe('C2');
  });

  test('lazy loadLocale dedupes concurrent loads', async () => {
    let loads = 0;
    let resolveMessages: ((messages: Record<string, string>) => void) | undefined;

    const messagesPromise = new Promise<Record<string, string>>((resolve) => {
      resolveMessages = resolve;
    });

    const i18n = new I18n({
      locale: 'en',
      lazyBundles: [
        {
          en: async () => {
            loads += 1;
            return messagesPromise;
          },
        },
      ],
    });

    const p1 = i18n.loadLocale('en');
    const p2 = i18n.loadLocale('en');

    expect(loads).toBe(1);

    resolveMessages?.({ hello: 'Hello' });

    await Promise.all([p1, p2]);
    expect(i18n.t('hello')).toBe('Hello');
  });

  describe('message format', () => {
    const DAYS = {
      ru: { 'bonus.days': 'Срок: {count, plural, one {# день} few {# дня} many {# дней} other {# дней}}' },
      en: { 'bonus.days': 'Period: {count, plural, one {# day} other {# days}}' },
    };

    test('picks the russian form through t()', () => {
      const i18n = new I18n({ locale: 'ru', bundles: [DAYS] });

      expect(i18n.t('bonus.days', { count: 1 })).toBe('Срок: 1 день');
      expect(i18n.t('bonus.days', { count: 3 })).toBe('Срок: 3 дня');
      expect(i18n.t('bonus.days', { count: 7 })).toBe('Срок: 7 дней');
    });

    test('follows the locale when it changes', async () => {
      const i18n = new I18n({ locale: 'ru', bundles: [DAYS] });
      expect(i18n.t('bonus.days', { count: 2 })).toBe('Срок: 2 дня');

      await i18n.changeLocale('en');
      expect(i18n.t('bonus.days', { count: 2 })).toBe('Period: 2 days');
      expect(i18n.t('bonus.days', { count: 1 })).toBe('Period: 1 day');
    });

    test('the same template renders differently for each count', () => {
      const i18n = new I18n({ locale: 'ru', bundles: [DAYS] });
      const rendered = [1, 2, 5, 21].map((count) => i18n.t('bonus.days', { count }));

      expect(rendered).toEqual(['Срок: 1 день', 'Срок: 2 дня', 'Срок: 5 дней', 'Срок: 21 день']);
    });

    test('# is grouped for the active locale', () => {
      const i18n = new I18n({ locale: 'ru', bundles: [DAYS] });
      expect(i18n.t('bonus.days', { count: 1000 })).toBe(`Срок: ${new Intl.NumberFormat('ru').format(1000)} дней`);
    });

    test('a plural message resolved through fallbackLocale still works', () => {
      const i18n = new I18n({ locale: 'ru', fallbackLocale: 'en', bundles: [{ en: DAYS.en }] });
      expect(i18n.t('bonus.days', { count: 2 })).toBe('Period: 2 days');
    });

    test('a malformed template degrades to its own text', () => {
      const i18n = new I18n({
        locale: 'ru',
        bundles: [{ ru: { 'broken.one': 'Срок: {count, plural, one {день}', 'broken.two': 'Дата: {d, date, short}' } }],
      });

      expect(i18n.t('broken.one', { count: 1 })).toBe('Срок: {count, plural, one {день}');
      expect(i18n.t('broken.two', { d: 1 })).toBe('Дата: {d, date, short}');
    });

    test('an alias inlines another message but does not carry arguments into it', () => {
      const i18n = new I18n({
        locale: 'ru',
        bundles: [{ ru: { ...DAYS.ru, 'bonus.summary': 'Бонус. {alias:bonus.days}' } }],
      });

      expect(i18n.t('bonus.summary', { count: 3 })).toBe('Бонус. Срок: # дней');
    });

    test('interpolate renders a plural template', () => {
      const i18n = new I18n({ locale: 'ru' });
      expect(i18n.interpolate('{count, plural, one {# приз} few {# приза} other {# призов}}', { count: 2 })).toBe('2 приза');
    });

    test('a message without arguments is untouched', () => {
      const i18n = new I18n({ locale: 'ru', bundles: [{ ru: { 'plain.text': 'Просто текст' } }] });
      expect(i18n.t('plain.text')).toBe('Просто текст');
    });
  });

  test.each([
    { chosen: 'ru', supported: ['en', 'ru'], expected: 'ru' },
    { chosen: 'ru-RU', supported: ['en', 'ru'], expected: 'ru' },
    { chosen: 'ru-RU', supported: ['en', 'ru', 'ru-RU'], expected: 'ru-RU' },
  ])('resolveLocale prefers the chosen locale $chosen as $expected', ({ chosen, supported, expected }) => {
    const locale = resolveLocale({
      chosen,
      languages: ['en-US'],
      supportedLocales: supported,
      defaultLocale: 'en',
    });

    expect(locale).toBe(expected);
  });

  test.each([
    { supported: ['en-US', 'en', 'ru'], expected: 'ru' },
    { supported: ['en-US', 'en', 'ru', 'ru-RU'], expected: 'ru-RU' },
  ])('resolveLocale selects the first supported platform language as $expected', ({ supported, expected }) => {
    const locale = resolveLocale({
      languages: ['de-DE', 'ru-RU', 'en-US'],
      supportedLocales: supported,
      defaultLocale: 'en',
    });

    expect(locale).toBe(expected);
  });

  test('resolveLocale falls back to the default locale', () => {
    const locale = resolveLocale({
      languages: ['de-DE'],
      supportedLocales: ['en', 'ru'],
      defaultLocale: 'en',
    });

    expect(locale).toBe('en');
  });

  test('storedLocale reads the named local storage value', () => {
    const platform = makePlatform({ local: makeStorage({ 'tagma.locale': 'ru' }) });

    expect(storedLocale('tagma.locale')(platform)).toBe('ru');
    expect(storedLocale('missing.locale')(platform)).toBeUndefined();
  });

  test('cookieLocale reads the named cookie value', () => {
    const platform = makePlatform({ cookies: makeCookies({ lang: 'ru' }) });

    expect(cookieLocale('lang')(platform)).toBe('ru');
    expect(cookieLocale('missing.locale')(platform)).toBeUndefined();
  });
});
