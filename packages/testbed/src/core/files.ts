export type Kind = 'unit' | 'resource' | 'e2e';

const RESOURCE = /\.itest\.[cm]?[jt]sx?$/;
const E2E = /\.e2e\.ts$/;

export const kindOf = (file: string): Kind => (E2E.test(file) ? 'e2e' : RESOURCE.test(file) ? 'resource' : 'unit');

export const HANG_MS = 180_000;

export const SLOW_MS: Readonly<Record<Kind, number>> = { unit: 1_000, resource: 10_000, e2e: 10_000 };
