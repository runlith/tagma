import type { WebContents } from 'electron';
import type { FramedChord, PageKey } from '../bridge.js';
import { BROWSER } from '../channels.js';
import { chordOf, sameChord } from './chords.js';

export function forwardFramed(owner: WebContents, framed: () => readonly FramedChord[]): void {
  owner.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const focused = owner.focusedFrame;
    if (focused === null || focused.frameTreeNodeId === owner.mainFrame.frameTreeNodeId) return;
    const chord = chordOf(input);
    const frame = focused.url;
    if (!framed().some((held) => sameChord(held.chord, chord) && frame.startsWith(held.frame))) return;
    event.preventDefault();
    owner.send(BROWSER.key, { page: null, chord, frame } satisfies PageKey);
  });
}
