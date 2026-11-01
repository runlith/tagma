declare const BUILT_RELEASE: string | undefined;
declare const BUILT_FEED: string | undefined;

export const PROGRAM_RELEASE_DEFINE = 'BUILT_RELEASE';

export const PROGRAM_RELEASE: string = typeof BUILT_RELEASE === 'string' ? BUILT_RELEASE : '0.1.0';

export const PROGRAM_FEED_DEFINE = 'BUILT_FEED';

export const PROGRAM_FEED: string | null = typeof BUILT_FEED === 'string' ? BUILT_FEED : null;
