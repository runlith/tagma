import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { DevicesRepo } from './Repo.js';
import { sections } from './settings.js';

export const DevicesLayer = Layer.mergeAll(SettingSections.contribute('devices', ...sections), DevicesRepo);
