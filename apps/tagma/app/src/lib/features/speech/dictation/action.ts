import Mic from '@lucide/svelte/icons/mic';
import type { ActionList } from '$lib/features/workspace/action.js';

export const HOLD = 'dictation.hold';

export const actions: ActionList = [{ id: HOLD, title: 'Hold to dictate', icon: Mic, hold: true, palette: false, keys: ['Alt+Space'] }];
