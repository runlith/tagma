import { SettingSections } from '$lib/features/settings/section.js';
import { sections } from './settings.js';

export const PowerLayer = SettingSections.contribute('power', ...sections);
