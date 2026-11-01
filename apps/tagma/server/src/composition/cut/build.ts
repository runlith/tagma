import { DEVELOPER } from '../developer/build.js';
import { buildCut } from './commands.js';

await buildCut(DEVELOPER, process.argv.slice(2));
