import { SettingSections } from '$lib/features/settings/section.js';
import { sections } from './settings.js';

export const ShellLayer = SettingSections.contribute('shell', ...sections);
