import { describe, expect, test } from 'bun:test';
import { CHANNELS } from './channel.js';
import { portBlock, surfaceDevPort } from './ports.js';

const ports = (port: number): readonly number[] => [surfaceDevPort(port), ...Object.values(portBlock(port))];

describe('the channels of one machine', () => {
  test('never share a port of their blocks, the surface dev port included', () => {
    const [stable, dev] = [ports(CHANNELS.stable.port), ports(CHANNELS.dev.port)];
    expect(stable.filter((port) => dev.includes(port))).toEqual([]);
  });

  test('never share a data directory, a command, a name or a bundle id', () => {
    for (const field of ['data', 'command', 'name', 'bundleId'] as const) {
      expect(CHANNELS.stable[field]).not.toBe(CHANNELS.dev[field]);
    }
  });
});
