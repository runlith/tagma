import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { SERVER_SRC } from '../repoRoot.js';
import { heard as frames, type ProtocolRig } from './protocolRig.js';

export type Sign = 'process' | 'steer' | 'compact';

export type RigAgent = {
  install(report: string): Effect.Effect<void, unknown>;
  turns(report: string): Effect.Effect<number, unknown>;
  interrupts(report: string): Effect.Effect<number, unknown>;
  seen(report: string, sign: Sign): Effect.Effect<number, unknown>;
  heard(report: string): Effect.Effect<string, unknown>;
  quiet(report: string): Effect.Effect<boolean, unknown>;
};

type Line = Readonly<Record<string, unknown>>;

const lines = (file: string): Effect.Effect<readonly Line[]> =>
  Effect.sync(() =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Line)
      : [],
  );

const counted = (report: string, method: string) =>
  Effect.map(frames(report), (heard) => heard.filter((line) => line.method === method).length);

const METHODS: Readonly<Record<Sign, string>> = { process: 'initialize', steer: '_tagma/steer', compact: '_tagma/compact' };

const READ: ReadonlySet<unknown> = new Set(['injected', 'startedNewTurn']);

const textOf = (params: unknown): string =>
  ((params as { readonly prompt?: readonly { readonly text?: string }[] } | undefined)?.prompt ?? [])
    .map((block) => block.text ?? '')
    .join('\n');

export const scriptedAgent = (rig: ProtocolRig['Service']): RigAgent => ({
  install: (report) => rig.agentBinary(report, 'tagma', 'claude-code'),
  turns: (report) =>
    Effect.map(
      frames(report),
      (heard) =>
        heard.filter(
          (line) =>
            line.method === 'session/prompt' ||
            (line.method === '_tagma/compact' && (line.params as { readonly at?: string } | undefined)?.at !== 'step'),
        ).length,
    ),
  interrupts: (report) => counted(report, 'session/cancel'),
  seen: (report, sign) => counted(report, METHODS[sign]),
  heard: (report) =>
    Effect.map(Effect.zip(frames(report), lines(`${report}.out`)), ([inbound, outbound]) => {
      const taken = new Set(
        outbound.flatMap((line) => (READ.has((line.result as { readonly outcome?: unknown } | undefined)?.outcome) ? [line.id] : [])),
      );
      return inbound
        .filter((line) => line.method === 'session/prompt' || (line.method === '_tagma/steer' && taken.has(line.id)))
        .map((line) => textOf(line.params))
        .join('\n');
    }),
  quiet: () => Effect.succeed(true),
});

const RUNNER = join(SERVER_SRC, 'composition', 'testing', 'threads', 'protocolRunner.ts');

const events = (report: string) => lines(report);

const signOf: Readonly<Record<Sign, (event: Line) => boolean>> = {
  process: (event) => event.event === 'process',
  steer: (event) => event.event === 'sent' && event.priority === 'next',
  compact: (event) => (event.event === 'sent' && event.compact === true) || (event.event === 'autoCompact' && event.enabled === true),
};

export const claudeAgent = (rig: ProtocolRig['Service']): RigAgent => ({
  install: (report) =>
    rig.files.writeFileString(
      join(rig.stage, 'bin', WORLD_COMMAND),
      ['#!/bin/sh', `exec '${process.execPath}' '${RUNNER}' --report '${report}'`].join('\n'),
      { mode: 0o755 },
    ),
  turns: (report) => Effect.map(events(report), (all) => all.filter((event) => event.event === 'model').length),
  interrupts: (report) => Effect.map(events(report), (all) => all.filter((event) => event.event === 'interrupt').length),
  seen: (report, sign) => Effect.map(events(report), (all) => all.filter(signOf[sign]).length),
  heard: (report) =>
    Effect.map(events(report), (all) =>
      all.flatMap((event) => (event.event === 'heard' && typeof event.text === 'string' ? [event.text] : [])).join('\n'),
    ),
  quiet: (report) =>
    Effect.map(events(report), (all) => all.filter((event) => event.event === 'busy' || event.event === 'idle').at(-1)?.event !== 'busy'),
});
