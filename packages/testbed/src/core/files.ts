export type Kind = 'unit' | 'resource';

const RESOURCE = /\.itest\.[cm]?[jt]sx?$/;

export const kindOf = (file: string): Kind => (RESOURCE.test(file) ? 'resource' : 'unit');

export const HANG_MS = 180_000;

export const SLOW_MS: Readonly<Record<Kind, number>> = { unit: 1_000, resource: 10_000 };
