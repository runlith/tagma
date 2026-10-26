import type { Resource } from './guards.ts';

export class Refused extends Error {
  readonly reason: string;

  constructor(
    readonly file: string,
    readonly resource: Resource,
    via: string,
  ) {
    const reason = `a unit test file may not call ${via}: test the owner through an in-memory fake of the port, or move the test that needs a real ${resource} to a .itest.ts file`;
    super(`${file} × ${resource}: ${reason}`);
    this.reason = reason;
    this.name = 'LayerViolation';
  }
}

export class NetworkReached extends Error {
  constructor(what: string) {
    super(`A test reached the network: ${what}. Tests speak to 127.0.0.1 or to a stubbed door, never to a vendor.`);
    this.name = 'NetworkReached';
    console.error(`[no-network] refused ${what}`);
  }
}

export const siteOf = (stack: string | undefined, skip: readonly string[]): string | undefined => {
  const frames = (stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim().replace(/^at /, ''))
    .filter((line) => line.includes('/') && !skip.some((part) => line.includes(part)));
  const ours = frames.filter((line) => !line.includes('/node_modules/'));
  return (ours.length > 0 ? ours : frames).slice(0, 4).join(' < ') || undefined;
};
