import { manifests } from '../../platform/contract/service/manifest.js';
import { CORE_MODULES } from '../core.js';
import { checkoutBuilds } from '../../checkout-builds/checkout-builds.js';
import { freshWorld } from '../../fresh-world/fresh-world.js';
import { reflections } from '../../reflections/reflections.js';

export const MODULES = manifests(...CORE_MODULES, checkoutBuilds, freshWorld, reflections);
