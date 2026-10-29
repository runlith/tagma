import { homedir } from 'node:os';
import { join } from 'node:path';

export const RELEASE = '151.0.7922.71';

export type Platform = 'mac-arm64' | 'mac-x64' | 'linux64' | 'win64' | 'win32';

export const platformOf = (os: string, arch: string): Platform | null => {
  if (os === 'darwin') return arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (os === 'linux' && arch === 'x64') return 'linux64';
  if (os === 'win32') return arch === 'x64' ? 'win64' : 'win32';
  return null;
};

export const executableIn = (directory: string, platform: Platform): string => {
  const unpacked = join(directory, `chrome-${platform}`);
  if (platform.startsWith('mac')) return join(unpacked, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  return join(unpacked, platform.startsWith('win') ? 'chrome.exe' : 'chrome');
};

export const cacheRoot = (): string => process.env.TAGMA_BROWSER_BUILDS ?? join(homedir(), '.cache', 'runlith', 'browser-builds');

export const cachedExecutable = (): string => {
  const platform = platformOf(process.platform, process.arch);
  if (platform === null) throw new Error(`Chrome for Testing has no build for ${process.platform}-${process.arch}`);
  return executableIn(join(cacheRoot(), 'chrome-for-testing', RELEASE), platform);
};
