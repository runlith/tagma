import { manifests } from '../../platform/contract/service/manifest.js';
import { CORE_MODULES } from '../core.js';
import { releaseChannel } from '../../release-channel/release-channel.js';

export const MODULES = manifests(...CORE_MODULES, releaseChannel);
