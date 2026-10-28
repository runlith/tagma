import { Recorder, scroller } from './recorder';

import type { MeasuredControl } from './recording';

export async function premeasure(recorder: Recorder, reach = 6000): Promise<MeasuredControl> {
  const root = scroller();
  const rows = new Set<string>();
  let frames = 0;
  const next = async () => {
    await recorder.frames();
    frames += 1;
  };
  root.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
  const start = Math.max(reach + root.clientHeight, root.scrollHeight - root.clientHeight * 4);
  const from = Math.max(0, start - reach - root.clientHeight);
  const to = Math.min(root.scrollHeight - root.clientHeight, start + root.clientHeight);
  root.scrollTop = to;
  await next();
  for (;;) {
    while (!recorder.stable()) await next();
    await next();
    await next();
    for (const row of root.querySelectorAll<HTMLElement>('[data-timeline-key]')) rows.add(row.dataset.timelineKey!);
    if (root.scrollTop <= from + 0.5) break;
    const before = root.scrollTop;
    root.scrollTop = Math.max(from, before - root.clientHeight / 2);
    await next();
    if (root.scrollTop >= before && root.scrollTop > from + 0.5) throw new Error('The control warmup could not advance');
  }
  root.scrollTop = Math.min(start, root.scrollHeight - root.clientHeight);
  await next();
  await next();
  return { rows: rows.size, frames, start: root.scrollTop, from, to };
}
