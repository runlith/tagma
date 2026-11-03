import { DATABASE_FILE, INSTALLATIONS } from './layout.js';
import { INSTALLATION_MODE } from './junction.js';
import { portBlock, portsEnv } from './ports.js';

export const besideEnv = (root: string, port: number): Record<string, string> => ({
  [INSTALLATION_MODE]: 'beside',
  TAGMA_DATABASE_PATH: `${root}/data/${DATABASE_FILE}`,
  TAGMA_INSTALL_ROOT: `${root}/${INSTALLATIONS}`,
  ...portsEnv(portBlock(port)),
});
