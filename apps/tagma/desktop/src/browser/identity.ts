import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BrowserIdentity } from '../bridge.js';

const IDENTITY_FILE = 'browser-identity';
const HOST_FILE = 'browser-host';
const ENGINE_COMMENT = '(KHTML, like Gecko)';
const GOOGLE_SIGN_IN = new Set(['accounts.google.com', 'accounts.youtube.com']);

export const cleanedAgent = (agent: string): string =>
  agent.includes(ENGINE_COMMENT) ? agent.replace(/\s+Electron\/\S+/u, '').replace(/(\)\s+)(?:[^)\s]+\s+)*?(Chrome\/)/u, '$1$2') : agent;

export const chosenIdentity = (userData: string): BrowserIdentity => {
  const file = join(userData, IDENTITY_FILE);
  return existsSync(file) && readFileSync(file, 'utf8').trim() === 'native' ? 'native' : 'cleaned';
};

export const chooseIdentity = (userData: string, identity: BrowserIdentity): void => {
  const file = join(userData, IDENTITY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${identity}\n`);
};

export const hostIdIn = (userData: string): string => {
  const file = join(userData, HOST_FILE);
  const held = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(held)) return held;
  const made = randomUUID();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${made}\n`);
  return made;
};

export const isGoogleSignIn = (url: string): boolean => URL.canParse(url) && GOOGLE_SIGN_IN.has(new URL(url).hostname.toLowerCase());

export const firefoxAgent = (): string => {
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10.15'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}; rv:140.0) Gecko/20100101 Firefox/140.0`;
};
