import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { sections } from './settings.js';
import { Shortcuts } from './Shortcuts.svelte.js';

export const ShortcutsLayer = Layer.mergeAll(SettingSections.contribute('shortcuts', ...sections), Shortcuts);
