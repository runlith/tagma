import { COMPACT, COMPACTED, FORK, SAID, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import { clientProfile } from '@runlith/hosted-runner/profile';

export const opencodeAcp = clientProfile({
  id: 'opencode',
  storage: { environment: 'OPENCODE_DATA_DIR', folder: 'opencode' },
  login: 'sign in with the official OpenCode CLI on the Providers screen',
  compaction: 'session',
  usage: 'measured',
  extensions: [COMPACT, COMPACTED, FORK, SAID, RETRYING],
});
