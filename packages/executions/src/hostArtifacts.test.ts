import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { holderEntryOf, identityOf, stampOf } from './hostArtifacts';
import { ArtifactManifest } from './protocol/artifact';
import { WIRE_RANGE } from './protocol/wire';

const readManifest = Schema.decodeUnknownSync(ArtifactManifest);

const digest = (fill: string) => `sha256:${fill.repeat(64)}`;

const declared = {
  identity: { digest: digest('2'), build: 'bundle' },
  protocol: 'executions/1',
  platform: { os: 'darwin', arch: 'arm64' },
  endpoint: { transport: 'unix', path: 'host.sock' },
  parts: [{ role: 'host', path: 'host/host.js', bytes: 1, digest: digest('3') }],
};

describe('the stamp a host records from its manifest', () => {
  it('the holder entry names declared launch roles and the boot input of their digest', () => {
    const manifest = readManifest({
      ...declared,
      wire: WIRE_RANGE,
      parts: [
        ...declared.parts,
        { role: 'holder', path: 'native/holder', bytes: 1, digest: digest('4') },
        { role: 'runtime', path: 'runtime/bun', bytes: 1, digest: digest('5') },
      ],
    });
    expect(holderEntryOf(manifest)).toBe(
      `holder native/holder\nbundle runtime/bun\nbundle host/host.js\nstate boot-${'2'.repeat(64)}.json\n`,
    );
  });
  it('names the range it negotiates and, beside it, the newest version of that range', () => {
    const stamp = stampOf(readManifest({ ...declared, wire: WIRE_RANGE }));
    expect(stamp.range).toEqual(WIRE_RANGE);
    expect(stamp.wire).toBe(WIRE_RANGE.max);
  });

  it('binds the artifact identity to its platform and endpoint', () => {
    const manifest = readManifest({ ...declared, wire: WIRE_RANGE });
    const digest = identityOf(manifest);
    expect(identityOf({ ...manifest, platform: { ...manifest.platform, os: 'linux' } })).not.toBe(digest);
    expect(identityOf({ ...manifest, platform: { ...manifest.platform, arch: 'x64' } })).not.toBe(digest);
    expect(identityOf({ ...manifest, endpoint: { ...manifest.endpoint, path: 'another.sock' } })).not.toBe(digest);
    expect(identityOf({ ...manifest, endpoint: { ...manifest.endpoint, transport: 'another' } })).not.toBe(digest);
  });
});
