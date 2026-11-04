import { failed, type Platform } from '../contract/platform.js';
import { makePlatform } from '../linux/platform.js';

export const currentPlatform = (): Platform =>
  process.platform === 'linux'
    ? makePlatform(process.env)
    : {
        prepare: () => Promise.resolve({ _tag: 'Ready', environment: { ...process.env } }),
        failed,
      };
