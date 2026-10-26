import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import type { Served } from '@runlith/executions/protocol/capability';
import { Host, type HostAdapter } from './session';

export const machineLoadContract = Effect.fnUntraced(function* (host: Host['Service']) {
  const served = yield* host.client.served();
  const opened = yield* Effect.result(host.client.load(process.pid));
  if (!served.has('machine-load')) {
    expect(opened._tag === 'Failure' ? opened.failure : undefined).toMatchObject({
      _tag: 'HostRefused',
      refusal: { _tag: 'UnsupportedCapability' },
    });
    return;
  }
  if (opened._tag === 'Failure') return yield* opened.failure;
  const readings = yield* opened.success.readings.pipe(Stream.take(2), Stream.runCollect);
  expect(readings).toHaveLength(2);
  const latest = readings[1]!;
  expect(latest.revision).toBeGreaterThan(readings[0]!.revision);
  expect(latest.cores).toBeGreaterThan(0);
  expect(latest.cpu).not.toBeNull();
  expect(latest.memory._tag).toBe('Measured');
  if (latest.memory._tag === 'Measured') {
    expect(latest.memory.totalBytes).toBeGreaterThan(0);
    expect(latest.memory.usedBytes + latest.memory.availableBytes).toBe(latest.memory.totalBytes);
  }
  const own = latest.groups.find((group) => group.owner._tag === 'Installation');
  const server = own?.processes.find((row) => row.identity.pid === process.pid);
  expect(server?.memoryBytes, JSON.stringify(own)).toBeGreaterThan(0);
  expect(server?.signal).toBe(false);
  const holder = own?.processes.find((row) => row.role === 'holder');
  expect(holder?.parent).toBe(process.pid);
  expect(own?.processes.some((row) => row.role === 'host' && row.parent === holder?.identity.pid)).toBe(true);
});

export const servingContracts = (adapter: HostAdapter, expected: Served) =>
  layer(adapter.layer, { excludeTestServices: true })(`${adapter.name} host capability contract`, (it) => {
    it.effect(
      'announces exactly the capabilities its adapter supports',
      () =>
        Effect.gen(function* () {
          const host = yield* Host;
          const served = yield* host.client.served();
          expect([...served].sort()).toEqual([...expected].sort());
        }),
      9_000,
    );
    it.effect(
      'delivers live machine and installation readings or refuses the unsupported capability',
      () => Effect.flatMap(Host, machineLoadContract),
      9_000,
    );
  });
