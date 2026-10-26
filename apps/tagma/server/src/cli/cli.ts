import { manifest } from '../platform/contract/service/manifest.js';
import { cliVerbs } from './verbs.js';

export const cli = manifest({
  id: 'cli',
  title: 'The tagma command line',
  verbs: cliVerbs,
});
