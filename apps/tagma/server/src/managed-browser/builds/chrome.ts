import type { WindowMode } from '../contract/wire/document.js';

const ARGS = [
  '--remote-debugging-pipe',
  '--disable-blink-features=AutomationControlled',
  '--test-type',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const HIDDEN = ['--headless=new', '--mute-audio', '--window-size=1280,800'];

const SHOWN = ['--no-startup-window'];

const SECRET_STORE: Readonly<Record<string, readonly string[]>> = {
  darwin: ['--use-mock-keychain'],
  linux: ['--password-store=basic'],
};

const PLATFORM_TOKEN: Readonly<Record<string, string>> = {
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
  win32: 'Windows NT 10.0; Win64; x64',
};

const agentOf = (release: string): string[] => {
  const token = PLATFORM_TOKEN[process.platform];
  const major = release.split('.')[0];
  return token === undefined || major === undefined
    ? []
    : [`--user-agent=Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`];
};

export const chromeArgs = (release: string, profileDir: string, window: WindowMode): readonly string[] => [
  ...ARGS,
  ...(window === 'hidden' ? [...HIDDEN, ...agentOf(release)] : SHOWN),
  ...(SECRET_STORE[process.platform] ?? []),
  `--user-data-dir=${profileDir}`,
];

export const RELEASE = /\b(\d+\.\d+\.\d+\.\d+)\b/;
