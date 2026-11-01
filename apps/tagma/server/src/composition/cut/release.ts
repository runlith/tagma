import { RELEASE } from '../release/build.js';
import { releaseCut } from './commands.js';

await releaseCut(RELEASE, process.argv.slice(2));
