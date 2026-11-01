import { manifests } from '../../platform/contract/service/manifest.js';
import { CORE_MODULES } from '../core.js';
import { graphRemote } from '../../graph-remote/graph-remote.js';
import { calls } from '../../calls/calls.js';
import { checkoutBuilds } from '../../checkout-builds/checkout-builds.js';
import { reflections } from '../../reflections/reflections.js';

export const MODULES = manifests(...CORE_MODULES, graphRemote, calls, checkoutBuilds, reflections);
