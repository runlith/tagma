import { contentOf, withBom } from '@runlith/files/content';
import { overlay } from '../lines/overlay.js';
import type { OverlayAnswer, OverlayAsk } from './overlay.js';

declare const self: Worker;

const textOf = (bytes: Uint8Array): string | null => {
  const held = contentOf(bytes);
  return held.kind === 'text' ? withBom(held) : null;
};

self.addEventListener('message', (event: MessageEvent<OverlayAsk>) => {
  try {
    const base = textOf(event.data.base);
    const staged = textOf(event.data.staged);
    self.postMessage(
      (base === null || staged === null
        ? { kind: 'unweighable' }
        : {
            kind: 'overlaid',
            text: overlay({ base, selected: event.data.selected, staged, working: event.data.working, positions: event.data.positions }),
          }) satisfies OverlayAnswer,
    );
  } catch (cause) {
    self.postMessage({ kind: 'failed', reason: String(cause) } satisfies OverlayAnswer);
  }
});
self.postMessage({ kind: 'ready' } satisfies OverlayAnswer);
