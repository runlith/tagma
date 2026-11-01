import { DEVELOPER } from '../developer/build.js';
import { RELEASE } from '../release/build.js';
import { tryCut } from './commands.js';

const released = process.argv.includes('--release');

await tryCut(
  released ? RELEASE : DEVELOPER,
  DEVELOPER.channel,
  process.argv.slice(2).filter((argument) => argument !== '--release'),
);
