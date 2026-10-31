import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { RulesRepo } from './Repo.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const RulesLayer = Layer.mergeAll(
  Surfaces.contribute('rules', ...surfaces),
  SettingSections.contribute('rules', ...sections),
  RulesRepo,
);
