import { join } from 'node:path';
import { type LoaderWindow, SurfaceLoader } from '../src/SurfaceLoader.js';
import type { LoaderState } from '../src/waitingPage.js';

type Met = {
  opened: boolean;
  readonly reopened: string[];
  readonly told: string[];
  readonly asked: string[];
  readonly shown: string[];
};

const STANDS = new Set<LoaderState['why']>([
  'named-address',
  'not-installed',
  'not-started',
  'unrestored',
  'foreign',
  'no-installation',
  'unknown',
]);
const OPENS_WITHIN_MS = 300_000;

const told = (code: string, reason: string): never => {
  console.log(JSON.stringify({ code, reason }));
  process.exit(2);
};

const flag = (name: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return (at < 0 ? undefined : process.argv[at + 1]) ?? told('usage', `--${name} names no value`);
};

const executable = (bundle: string): string => join(bundle, 'Contents', 'MacOS', 'Electron');

const met = (bundle: string, url: string): Promise<Met> =>
  new Promise((settled) => {
    const seen: Met = { opened: false, reopened: [], told: [], asked: [], shown: [] };
    const done = () => settled(seen);
    const window: LoaderWindow = {
      open: () => {
        seen.opened = true;
        done();
      },
      show: (standing) => {
        seen.shown.push(standing.why);
        if (STANDS.has(standing.why)) done();
      },
      offer: async () => false,
      ask: async (said) => {
        seen.asked.push(said);
        return true;
      },
      told: (title, refusal) => {
        seen.told.push(`${title}: ${refusal.code}: ${refusal.reason}`);
      },
      reopen: (at) => {
        seen.reopened.push(at);
        done();
      },
      settled: () => undefined,
      fell: async () => 'left',
    };
    new SurfaceLoader(new URL(url), { executable: executable(bundle), env: process.env, named: false }, window).start();
    setTimeout(done, OPENS_WITHIN_MS).unref();
  });

if (process.argv[2] !== 'open') told('usage', 'transition open --app <bundle> --url <url>');
console.log(JSON.stringify(await met(flag('app'), flag('url'))));
process.exit(0);
