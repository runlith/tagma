import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { CALLS_FEED } from '../wire/calls.js';
import type { THREAD_NATIVE_FEEDS } from '../wire/threadFeeds.js';
import type { CallActivity } from './calls.js';

export type NativeFeeds = readonly [typeof CALLS_FEED, ...typeof THREAD_NATIVE_FEEDS];

export type NativeLive = LiveDeclaration<NativeFeeds, CallActivity>;
