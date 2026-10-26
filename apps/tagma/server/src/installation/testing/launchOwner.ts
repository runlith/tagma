import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerLaunch } from '../process/launch.js';

const home = process.env.LAUNCH_TEST_HOME;
if (home === undefined) throw new Error('LAUNCH_TEST_HOME is required');
const server = fileURLToPath(new URL('./launchServer.ts', import.meta.url));
const launch = new ServerLaunch([process.execPath, server], process.env, join(home, 'serve.log'));
process.exitCode = await launch.exited;
