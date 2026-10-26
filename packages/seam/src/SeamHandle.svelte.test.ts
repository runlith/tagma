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
