import { describe, expect, it } from 'bun:test';
import { Result } from 'effect';
import { CHANNELS } from './contract/wire/channel.js';
import { databasePathIn, installationRootIn } from './paths.js';

const channel = CHANNELS.dev;

describe('paths without a home', () => {
  it('refuses with the variable that would stand in for HOME', () => {
    const database = databasePathIn(channel, {});
    const installation = installationRootIn(channel, {});
    expect(Result.isFailure(database) && database.failure.variable).toBe('TAGMA_DATABASE_PATH');
    expect(Result.isFailure(installation) && installation.failure.variable).toBe('TAGMA_INSTALL_ROOT');
  });

  it('answers from the variable alone, and from HOME under the channel’s own directory', () => {
    expect(Result.getOrThrow(databasePathIn(channel, { TAGMA_DATABASE_PATH: ' /data/tagma.sqlite ' }))).toBe('/data/tagma.sqlite');
    expect(Result.getOrThrow(installationRootIn(channel, { TAGMA_INSTALL_ROOT: '/opt/tagma' }))).toBe('/opt/tagma');
    expect(Result.getOrThrow(databasePathIn(CHANNELS.dev, { HOME: '/home/someone' }))).toBe('/home/someone/.tagma-dev/tagma.sqlite');
    expect(Result.getOrThrow(installationRootIn(CHANNELS.stable, { HOME: '/home/someone' }))).toBe('/home/someone/.tagma/install');
  });
});
