import { RELEASE } from '../release/build.js';
import { transitionCut } from './commands.js';

await transitionCut(RELEASE, process.argv.slice(2));
