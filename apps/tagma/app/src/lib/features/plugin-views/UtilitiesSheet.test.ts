// @vitest-environment jsdom
import { Failure } from '@runlith/layer/Failure';
import { flush } from '@runlith/testing/flush';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { adoptedSheet } from './UtilitiesSheet.js';

const UNION = '@layer utilities { .flex { display: flex } .p-2 { padding: 0.5rem } .plugin-only { color: red } }';
const WINDOW_CSS = '@layer theme, base, utilities; @layer utilities { .flex { display: flex } } .own { color: blue }';

let style: HTMLStyleElement;

const ruleNames = (): string[] =>
  [...(document.styleSheets[0] as CSSStyleSheet).cssRules].map((rule) => rule.cssText.split('{')[0]!.trim());

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = WINDOW_CSS;
  document.head.append(style);
  document.adoptedStyleSheets = [];
});

afterEach(() => {
  style.remove();
});

test('the union stands in for the window’s own utilities and the window’s block returns when the union goes', async () => {
  const sheet = adoptedSheet(async () => UNION, new Failure(undefined), window.location.origin);
  expect(ruleNames()).toEqual(['@layer theme, base, utilities;', '@layer utilities', '.own']);
  sheet.show('/union.css');
  await flush();
  expect(document.adoptedStyleSheets).toHaveLength(1);
  expect(ruleNames()).toEqual(['@layer theme, base, utilities;', '.own']);
  sheet.show(null);
  expect(document.adoptedStyleSheets).toHaveLength(0);
  expect(ruleNames()).toEqual(['@layer theme, base, utilities;', '@layer utilities', '.own']);
});

test('a failed load keeps the previous sheet, reports once per address, and the next delivery of the address reads it again', async () => {
  const reported: unknown[] = [];
  const reads: string[] = [];
  let down = true;
  const sheet = adoptedSheet(
    async (address) => {
      reads.push(address);
      if (address === '/next.css' && down) throw new Error('/next.css answered 500');
      return UNION;
    },
    new Failure((reason) => reported.push(reason)),
    window.location.origin,
  );
  sheet.show('/union.css');
  await flush();
  const [standing] = document.adoptedStyleSheets;
  sheet.show('/next.css');
  await flush();
  sheet.show('/next.css');
  await flush();
  expect(document.adoptedStyleSheets).toEqual([standing]);
  expect(reads).toEqual(['/union.css', '/next.css', '/next.css']);
  expect(reported).toEqual([new Error('/next.css answered 500')]);
  down = false;
  sheet.show('/next.css');
  await flush();
  expect(document.adoptedStyleSheets).toHaveLength(1);
  expect(document.adoptedStyleSheets[0]).not.toBe(standing);
  sheet.show('/next.css');
  await flush();
  expect(reads).toEqual(['/union.css', '/next.css', '/next.css', '/next.css']);
});
