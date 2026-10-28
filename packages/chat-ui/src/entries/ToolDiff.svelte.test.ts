// @vitest-environment jsdom
import { parseTextPatch, type PatchHunk, type PatchLine } from '@runlith/utils/patch';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeAll, expect, test } from 'vitest';
import ToolDiff from './ToolDiff.svelte';

const VIEWPORT_PX = 400;
const ROW_PX = 20;

let drawn: Record<string, unknown> | undefined;
let target: HTMLElement | undefined;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.index === undefined ? VIEWPORT_PX : ROW_PX;
    },
  });
});

afterEach(() => {
  if (drawn) void unmount(drawn);
  if (target) target.remove();
  drawn = undefined;
  target = undefined;
});

function draw(props: Record<string, unknown>): HTMLElement {
  target = document.createElement('div');
  document.body.append(target);
  drawn = mount(ToolDiff, { target, props: props as never }) as Record<string, unknown>;
  flushSync();
  return target;
}

const TWO_STRETCHES = ['@@ -1,2 +1,2 @@', ' one', '-two', '+three', '@@ -40,1 +40,2 @@', ' forty', '+added'].join('\n');

const seed = parseTextPatch(['@@ -1,1 +1,1 @@', ' seed'].join('\n'))[0]?.lines[0];
if (seed === undefined) throw new Error('the patch owner parsed no line to build a case from');

const at = (kind: PatchLine['kind'], text: string, before: number | null, after: number | null): PatchLine => ({
  ...seed,
  kind,
  text,
  before,
  after,
});

test('a patch as text and the stretches already parsed draw the same rows and the same break', () => {
  const fromText = draw({ patch: TWO_STRETCHES }).textContent ?? '';
  if (drawn) void unmount(drawn);
  target?.remove();

  const hunks: readonly PatchHunk[] = [
    {
      beforeStart: 1,
      afterStart: 1,
      hiddenBefore: 0,
      hiddenAt: 0,
      lines: [at('context', 'one', 1, 1), at('removed', 'two', 2, null), at('added', 'three', null, 2)],
    },
    {
      beforeStart: 40,
      afterStart: 40,
      hiddenBefore: 37,
      hiddenAt: 3,
      lines: [at('context', 'forty', 40, 40), at('added', 'added', null, 41)],
    },
  ];

  expect(draw({ patch: hunks }).textContent).toBe(fromText);
  expect(target?.textContent).toContain('37');
});

test('a patch of thousands of lines holds far fewer rows than lines, and scrolling reaches its last', async () => {
  const count = 6_000;
  const patch = [`@@ -1,${count} +1,${count} @@`, ...Array.from({ length: count }, (_unused, index) => ` line ${index + 1}`)].join('\n');
  const host = draw({ patch });
  const list = host.querySelector<HTMLElement>('[data-index]')?.parentElement as HTMLElement;
  const scroller = list.parentElement as HTMLElement;

  expect(host.querySelectorAll('[data-index]').length).toBeLessThan(count / 10);
  expect(list.style.height).toBe(`${count * ROW_PX}px`);

  scroller.scrollTop = count * ROW_PX - VIEWPORT_PX;
  scroller.dispatchEvent(new Event('scroll'));
  await settled();

  expect(host.textContent).toContain(`line ${count}`);
  expect(host.querySelectorAll('[data-index]').length).toBeLessThan(count / 10);
});

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

test('the port is asked once, with the patch lines and no signs or stretch headers', async () => {
  const asked: { code: string; language: string | undefined }[] = [];
  const highlight = (code: string, language: string | undefined) => {
    asked.push({ code, language });
    return Promise.resolve(new Map<number, readonly { text: string }[]>());
  };

  draw({ patch: TWO_STRETCHES, language: 'ts', highlight });
  await settled();

  expect(asked).toHaveLength(1);
  expect(asked[0]?.code).toBe(['one', 'two', 'three', 'forty', 'added'].join('\n'));
  expect(asked[0]?.language).toBe('ts');
});

test('each mounted reader asks under a name of its own', async () => {
  const askers: string[] = [];
  const highlight = (_code: string, _language: string | undefined, asker: string) => {
    askers.push(asker);
    return Promise.resolve(new Map<number, readonly { text: string }[]>());
  };

  draw({ patch: TWO_STRETCHES, highlight });
  await settled();
  if (drawn) void unmount(drawn);
  target?.remove();

  draw({ patch: TWO_STRETCHES, highlight });
  await settled();

  expect(askers).toHaveLength(2);
  expect(askers[0]).not.toBe(askers[1]);
});

test("a line's tokens draw as its colours, and a line the port left plain draws as it did without one", async () => {
  const plain = draw({ patch: TWO_STRETCHES }).textContent ?? '';
  expect(target?.querySelectorAll('[style*="color"]')).toHaveLength(0);
  if (drawn) void unmount(drawn);
  target?.remove();

  const highlight = () =>
    Promise.resolve(
      new Map([
        [
          0,
          [
            { text: 'o', color: '#ff0000' },
            { text: 'ne', color: '#00ff00' },
          ],
        ],
        [2, [{ text: 'three', color: '#0000ff' }]],
      ]),
    );

  const host = draw({ patch: TWO_STRETCHES, language: 'ts', highlight });
  await settled();

  expect(host.textContent).toBe(plain);
  expect([...host.querySelectorAll<HTMLElement>('[style*="color"]')].map((node) => node.style.color)).toEqual([
    'rgb(255, 0, 0)',
    'rgb(0, 255, 0)',
    'rgb(0, 0, 255)',
  ]);
});

test('a binary file draws no rows, and a patch past the soft ceiling draws none until it is pressed', () => {
  expect(draw({ patch: TWO_STRETCHES, binary: true }).querySelectorAll('[data-index]')).toHaveLength(0);
  if (drawn) void unmount(drawn);
  target?.remove();

  const count = 12_000;
  const large = [`@@ -1,${count} +1,${count} @@`, ...Array.from({ length: count }, (_unused, index) => ` line ${index + 1}`)].join('\n');
  const host = draw({ patch: large });

  expect(host.querySelectorAll('[data-index]')).toHaveLength(0);
  const press = host.querySelector('button');
  expect(press).not.toBeNull();

  press?.click();
  flushSync();

  expect(host.querySelectorAll('[data-index]').length).toBeGreaterThan(0);
  expect(host.querySelectorAll('[data-index]').length).toBeLessThan(count / 10);
});
