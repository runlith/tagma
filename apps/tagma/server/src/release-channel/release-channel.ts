import { manifest } from '../platform/contract/service/manifest.js';
import { RELEASE_SETTING_KEYS, RELEASE_SETTING_SECTIONS } from './settings.js';
import { releaseVerbs } from './verbs.js';

export const releaseChannel = manifest({
  id: 'release-channel',
  title: 'Releases',
  verbs: releaseVerbs,
  settings: RELEASE_SETTING_KEYS,
  settingSections: RELEASE_SETTING_SECTIONS,
});
