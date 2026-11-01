import { RETRYING, SAID } from '@runlith/hosted-runner/wire/extensions';
import { clientProfile } from '@runlith/hosted-runner/profile';

export const cursorAcp = clientProfile({
  id: 'cursor',
  compaction: 'vendor',
  usage: 'partial',
  storage: { environment: 'CURSOR_DATA_DIR', folder: 'cursor-sdk' },
  login: 'sign in to Cursor on the Providers screen',
  extensions: [SAID, RETRYING],
});
