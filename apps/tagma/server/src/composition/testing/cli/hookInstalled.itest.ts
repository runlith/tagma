import { expect } from 'bun:test';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { spawnedEffect } from '../../../platform/testing/spawn.js';

it.live('an installed harness answers through its hook codec, and an undeclared id refuses', () =>
  Effect.gen(function* () {
    const probe = yield* spawnedEffect([process.execPath, '--no-install', join(import.meta.dir, 'installedHook.ts')]);
    expect(probe.exitCode, probe.stderr.toString() + probe.stdout.toString()).toBe(0);
    const line = probe.stdout
      .toString()
      .split('\n')
      .find((line) => line.startsWith('installed-hook '));
    const result = JSON.parse(line!.slice('installed-hook '.length));
    expect(JSON.parse(result.unrelated.out)).toMatchObject({ status: 'ok', plugin: { id: 'broken-plugin' } });
    expect(JSON.parse(result.installed.out)).toMatchObject({
      status: 'ok',
      plugin: { id: 'quill-plugin', providers: { harnesses: true } },
    });
    expect(result.failed).toMatchObject({ state: 'failed', reason: expect.stringContaining('unrelated plugin is broken') });
    expect(result.answered.code).toBe(0);
    const said = JSON.parse(result.answered.out);
    expect(Object.keys(said)).toEqual(['quill']);
    expect(said.quill.context.length).toBeGreaterThan(0);
    expect(result.read.code).toBe(0);
    expect(JSON.parse(result.read.out).quill.after.length).toBeGreaterThan(0);
    expect(result.unnamed.code).toBe(0);
    expect(JSON.parse(result.unnamed.out).quill.context.length).toBeGreaterThan(0);
    expect(result.unknown.code).not.toBe(0);
    expect(result.unknown.err).toContain('harness-not-installed');
    expect(result.mcp.err).toContain('mcp-unsigned');
    expect(JSON.parse(result.removed.out)).toMatchObject({ status: 'ok', plugin: { id: 'quill-plugin' } });
    expect(result.missing.err).toContain('harness-not-installed');
  }),
);
