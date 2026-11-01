import { clientProfile } from '@runlith/hosted-runner/profile';
import { ASIDE, COMPACT, COMPACTED, QUOTA, RETRYING, SAID, STEER, WITHDRAW } from '@runlith/hosted-runner/wire/extensions';

export const MUSE_CODE = 'muse-code';

export const MUSE_CODE_STORAGE = 'MUSE_CODE_DIR';

export const MUSE_CODE_EXTENSIONS = [STEER, WITHDRAW, COMPACT, ASIDE, SAID, COMPACTED, RETRYING, QUOTA] as const;

export const museCodeAcp = clientProfile({
  id: MUSE_CODE,
  storage: { environment: MUSE_CODE_STORAGE, folder: MUSE_CODE },
  program: 'muse',
  login: 'muse login',
  compaction: 'session',
  usage: 'measured',
  midTurn: 'steer',
  web: 'vendor',
  aside: 'session',
  extensions: MUSE_CODE_EXTENSIONS,
});
