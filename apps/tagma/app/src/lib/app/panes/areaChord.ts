import type { Chord } from '@tagma/desktop/bridge';
import type { Keymap } from '../keys/Keymap.svelte.js';

export const areaChord = (keymap: Keymap): Chord => keymap.mod('Backslash', { alt: true });
