declare const BUILT_RELEASE: string | undefined;

export const PROGRAM_RELEASE_DEFINE = 'BUILT_RELEASE';

export const PROGRAM_RELEASE: string = typeof BUILT_RELEASE === 'string' ? BUILT_RELEASE : '0.1.0';
