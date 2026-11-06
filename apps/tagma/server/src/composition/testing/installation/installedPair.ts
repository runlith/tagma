import { Effect } from 'effect';
import { checkoutInstalled, leavingCopy } from './installed.js';

const [root, channel, before, leaving] = process.argv.slice(2);
if (root === undefined || channel === undefined || leaving === undefined)
  throw new Error('usage: installedPair.ts <root> <channel json> <build before> <build leaving>');
const landed = await Effect.runPromise(checkoutInstalled(root, JSON.parse(channel), before));
const left = await Effect.runPromise(leavingCopy(landed, leaving));
process.stdout.write(`${JSON.stringify({ before: { version: landed.version, root: landed.root }, leaving: left })}\n`);
