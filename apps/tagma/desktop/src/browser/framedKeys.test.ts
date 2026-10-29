import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import type { Chord } from '../bridge.js';
import { BROWSER } from '../channels.js';
import { forwardFramed } from './framedKeys.js';

type Frame = { readonly frameTreeNodeId: number; readonly url: string };

const APP: Frame = { frameTreeNodeId: 1, url: 'http://127.0.0.1:5633/runlith/chat' };
const PAGE = 'http://127.0.0.1:5634/a/0123456789ab/v/20261025T000000000Z';

class Contents extends EventEmitter {
  readonly mainFrame = APP;
  focusedFrame: Frame | null = APP;
  readonly sent: [string, unknown][] = [];
  send(channel: string, value: unknown): void {
    this.sent.push([channel, value]);
  }
}

const ZOOM_IN: Chord = { code: 'Equal', meta: true, ctrl: false, alt: false, shift: false };

const press = (owner: Contents, code: string): boolean => {
  let prevented = false;
  owner.emit(
    'before-input-event',
    { preventDefault: () => (prevented = true) },
    { type: 'keyDown', code, meta: true, control: false, alt: false, shift: false },
  );
  return prevented;
};

test('a chord the app takes from one framed page reaches it from that page alone, and stays with the window, other frames and other chords', () => {
  const owner = new Contents();
  forwardFramed(owner as unknown as WebContents, () => [{ chord: ZOOM_IN, frame: PAGE }]);

  expect(press(owner, 'Equal')).toBe(false);
  owner.focusedFrame = { frameTreeNodeId: 7, url: 'http://127.0.0.1:5635/views/board/' };
  expect(press(owner, 'Equal')).toBe(false);
  owner.focusedFrame = { frameTreeNodeId: 8, url: `${PAGE}#totals` };
  expect(press(owner, 'KeyK')).toBe(false);
  expect(press(owner, 'Equal')).toBe(true);
  expect(owner.sent).toEqual([[BROWSER.key, { page: null, chord: ZOOM_IN, frame: `${PAGE}#totals` }]]);
});
