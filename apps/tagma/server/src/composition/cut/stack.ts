import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stackCommand } from '../../installation/cut/stack.js';
import { CHANNEL } from '../developer/channel.js';

await stackCommand(resolve(fileURLToPath(new URL('../../../../../../', import.meta.url))), process.argv.slice(2), CHANNEL);
