// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { I18n } from './I18n.svelte.js';
import I18nLocaleSwitchTest from './I18nLocaleSwitchTest.svelte';

function textContent(root: ParentNode, testId: string): string {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`Missing element ${testId}`);
  return el.textContent ?? '';
}

function isDisabled(root: ParentNode, testId: string): boolean {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`Expected button ${testId}`);
  return el.disabled;
}

function click(root: ParentNode, testId: string): void {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`Expected element ${testId}`);
  el.click();
}

describe('I18n (Svelte reactivity integration)', () => {
  it('updates DOM when locale is assigned directly', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: { greet: 'Hello' },
          ru: { greet: 'Привет' },
        },
      ],
    });

    const app = mount(I18nLocaleSwitchTest, { target, props: { i18n } });

    expect(textContent(target, 'locale')).toBe('en');
    expect(textContent(target, 'greet')).toBe('Hello');
    expect(isDisabled(target, 'en-disabled')).toBe(true);
    expect(isDisabled(target, 'ru-disabled')).toBe(false);

    click(target, 'set-ru');
    await tick();

    expect(textContent(target, 'locale')).toBe('ru');
    expect(textContent(target, 'greet')).toBe('Привет');
    expect(isDisabled(target, 'en-disabled')).toBe(false);
    expect(isDisabled(target, 'ru-disabled')).toBe(true);

    await unmount(app);
  });

  it('updates DOM when locale is changed via changeLocale', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const i18n = new I18n({
      locale: 'en',
      bundles: [
        {
          en: { greet: 'Hello' },
          ru: { greet: 'Привет' },
        },
      ],
    });

    const app = mount(I18nLocaleSwitchTest, { target, props: { i18n } });

    click(target, 'change-ru');
    await tick();
    await Promise.resolve();
    await tick();

    expect(textContent(target, 'locale')).toBe('ru');
    expect(textContent(target, 'greet')).toBe('Привет');

    await unmount(app);
  });
});
