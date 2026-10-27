import { flushSync, mount, unmount } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { Seam } from './Seam.svelte';
import SeamHandle from './SeamHandle.svelte';

const SPAN_PX = 400;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function pointer(type: string, x: number): PointerEvent {
  return new PointerEvent(type, { button: 0, pointerId: 1, clientX: x, clientY: 10, bubbles: true });
}

test('a drag keeps its grip while every frame rewrites the split the seam reads', () => {
  const frames: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const tab = $state({ split: { direction: 'row', ratio: 0.5 } });
  const commits: number[] = [];
  const seam = new Seam(
    {
      get axis() {
        return tab.split.direction === 'row' ? 'x' : 'y';
      },
      base: 0,
      min: 50,
      max: Number.POSITIVE_INFINITY,
      rest: 50,
      get fill() {
        return tab.split.ratio;
      },
    },
    {
      onDrag: (_size, fill) => {
        tab.split = { direction: 'row', ratio: fill };
      },
      onCommit: (_size, fill) => commits.push(fill),
    },
  );
  const row = document.createElement('div');
  Object.defineProperty(row, 'clientWidth', { value: SPAN_PX + 1, configurable: true });
  document.body.appendChild(row);
  const app = mount(SeamHandle, { target: row, props: { seam, label: 'Resize the split', contained: true, line: 1 } });
  flushSync();
  const handle = row.querySelector<HTMLElement>('[role="separator"]');
  if (handle === null) throw new Error('No handle drawn.');

  handle.dispatchEvent(pointer('pointerdown', 200));
  for (const x of [180, 160, 140]) {
    window.dispatchEvent(pointer('pointermove', x));
    for (const frame of frames.splice(0)) frame();
    flushSync();
    expect(seam.dragging).toBe(true);
  }
  window.dispatchEvent(pointer('pointerup', 140));

  expect(commits).toEqual([140 / SPAN_PX]);
  unmount(app);
});

test('handles drawing one seam light together, keep the light across a new seam, and one leaving spares the drag of the other', () => {
  const pane = { base: 240, min: 120, max: 480 };
  const top = $state({ seam: new Seam(pane), label: 'Resize the column' });
  const below = $state({ seam: top.seam, label: 'Resize the column' });
  const upper = mount(SeamHandle, { target: document.body, props: top });
  const lower = mount(SeamHandle, { target: document.body, props: below });
  flushSync();
  const [upperButton, lowerButton] = document.body.querySelectorAll<HTMLElement>('[role="separator"]');
  if (upperButton === undefined || lowerButton === undefined) throw new Error('Two handles were not drawn.');

  upperButton.dispatchEvent(new PointerEvent('pointerenter'));
  flushSync();
  expect(lowerButton.classList.contains('lit')).toBe(true);

  const next = new Seam({ ...pane, size: 300 });
  top.seam = next;
  below.seam = next;
  flushSync();
  expect(lowerButton.classList.contains('lit')).toBe(true);

  lowerButton.dispatchEvent(pointer('pointerdown', 300));
  unmount(upper);
  flushSync();
  expect(next.dragging).toBe(true);
  expect(next.hovered).toBe(false);

  window.dispatchEvent(pointer('pointerup', 300));
  unmount(lower);
});
