import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { ArtifactManifest, highestCommon } from './artifact';

const readManifest = Schema.decodeUnknownSync(ArtifactManifest);

const digest = (fill: string) => `sha256:${fill.repeat(64)}`;

const declared = {
  identity: { digest: digest('2'), build: 'bundle' },
  protocol: 'executions/1',
  platform: { os: 'darwin', arch: 'arm64' },
  endpoint: { transport: 'unix', path: 'host.sock' },
  parts: [{ role: 'host', path: 'host/host.js', bytes: 1, digest: digest('3') }],
};

describe('a wire range', () => {
  it('meets another at the highest version both hold', () => {
    expect(highestCommon({ min: 35, max: 37 }, { min: 36, max: 40 })).toBe(37);
    expect(highestCommon({ min: 35, max: 35 }, { min: 35, max: 35 })).toBe(35);
    expect(highestCommon({ min: 35, max: 35 }, { min: 36, max: 37 })).toBeUndefined();
  });
});

describe('the artifact manifest boundary', () => {
  it('reads the build platform and endpoint, and refuses an inverted wire range', () => {
    const manifest = readManifest({ ...declared, wire: { min: 35, max: 36 } });
    expect(manifest.platform).toEqual(declared.platform);
    expect(manifest.endpoint).toEqual(declared.endpoint);
    expect(manifest.wire).toEqual({ min: 35, max: 36 });
    expect(() => readManifest({ ...declared, wire: { min: 36, max: 35 } })).toThrow();
  });
});
