import type { Platform } from '@runlith/chrome-for-testing/launch/platform';
import { Context } from 'effect';

export class LaunchPlatform extends Context.Service<LaunchPlatform, Platform>()('tagma/managed-browser/LaunchPlatform') {}
