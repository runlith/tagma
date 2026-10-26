import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'artifact-unknown': 'Page not on the shelf',
  'browser-unavailable': 'Browser cannot start',
  'codec-unavailable': 'Video encoder unavailable',
  'disk-full': 'Not enough disk space',
  'empty-page': 'Page file is empty',
  'frame-out-of-range': 'Frame past the timeline',
  'no-such-page': 'No page file there',
  'no-timeline': 'Page declares no timeline',
  'page-failed': 'Page failed to draw',
  'page-unnamed': 'Page not named',
  'video-unknown': 'No such video export',
} as const satisfies RefusalWords;
