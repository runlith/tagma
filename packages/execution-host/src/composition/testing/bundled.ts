import { endpointConnection } from '@runlith/executions/posix/endpoint';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect, Exit, Schema, Scope } from 'effect';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { digestOf, holderEntryOf, identityOf } from '@runlith/executions/hostArtifacts';
import { ARTIFACT_FILE, HOLDER_ENTRY_FILE, type ArtifactManifest } from '@runlith/executions/protocol/artifact';
import { bootPath, HostBoot } from '@runlith/executions/protocol/boot';
import { HostRequestRef } from '@runlith/executions/protocol/execution';
import type { PrepareAnswer } from '@runlith/executions/protocol/runtime';
import { copyBundle } from './artifact';
import { HOLDER_BINARY } from '../../posix/testing/holder';
import { nativeArtifact } from '../artifact';
import { hostPolicy, hostShare, hostWireLimits, registrationOf, spawned } from '../../hostFixture';
import type { Client } from './session';

const HOLDER_PART = 'native/execution-holder';
const LIBRARY_PART = `native/${nativeArtifact()!.library}`;

export type Offer = {
  readonly build: string;
  readonly holder?: 'standing' | 'distinct' | 'refusing';
  readonly logic?: 'working' | 'boot-exit' | 'store-ahead' | 'store-repair' | 'over-store-ahead';
};

const storeStep = (sql: string) =>
  [
    '{',
    "const { Database } = require('bun:sqlite');",
    "const { dirname, join } = require('node:path');",
    "const store = new Database(join(dirname(process.argv[2]), 'executions.sqlite'));",
    `store.run(${JSON.stringify(sql)});`,
    'store.close();',
    '}',
    '',
  ].join('\n');
const AHEAD_ROW = storeStep(
  "insert into __drizzle_migrations (hash, created_at, name) select 'ahead', 9999999999999, 'ahead' where not exists (select 1 from __drizzle_migrations where hash = 'ahead')",
);
const STORE_AHEAD = AHEAD_ROW + 'process.exit(3);\n';
const STORE_REPAIR = storeStep("delete from __drizzle_migrations where hash = 'ahead'");

export type Stand = {
  readonly client: Client;
  readonly directory: string;
  readonly holderPid: number;
  readonly operation: () => HostRequestRef;
  readonly logicPid: () => Promise<number>;
  readonly offer: (offer: Offer) => Promise<void>;
  readonly stage: (offer: Offer) => Promise<() => void>;
  readonly prepare: () => Promise<PrepareAnswer>;
  readonly change: () => Promise<PrepareAnswer>;
  readonly away: () => Promise<void>;
  readonly signalLogic: () => Promise<void>;
  readonly killLogic: () => Promise<void>;
  readonly served: () => Promise<void>;
  readonly heard: (text: string) => Promise<void>;
  readonly output: () => string;
  readonly resumes: () => ReadonlyArray<string>;
  readonly custodyFound: () => ReadonlyArray<string>;
  readonly endpointsFound: () => ReadonlyArray<string>;
  readonly dispose: () => Promise<void>;
};

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const rewritten = (root: string, manifest: ArtifactManifest, path: string, bytes: Uint8Array): ArtifactManifest => {
  writeFileSync(join(root, path), bytes, { mode: 0o700 });
  const parts = manifest.parts.map((part) => (part.path === path ? { ...part, bytes: bytes.length, digest: digestOf(bytes) } : part));
  const content = { ...manifest, parts };
  const next = { ...content, identity: { ...manifest.identity, digest: identityOf(content) } };
  writeFileSync(join(root, ARTIFACT_FILE), JSON.stringify(next));
  writeFileSync(join(root, HOLDER_ENTRY_FILE), holderEntryOf(next)!, { mode: 0o600 });
  return next;
};

export const bundledStand = async (directory: string, executions: number): Promise<Stand> => {
  const registration = registrationOf(directory);
  const policy = hostPolicy({ executions, custodyReceipts: 128 });
  const funded = {
    ...policy,
    host: { ...policy.host, bindings: 32, custodyReceipts: 128, tombstones: 32 },
    execution: {
      ...policy.execution,
      input: { ...policy.execution.input, pendingBytes: 256 * 1024, chunkBytes: 32 * 1024 },
      output: { ...policy.execution.output, retainedBytes: 256 * 1024 },
      geometry: { rows: 24, columns: 80, scrollbackRows: 100 },
      receipts: 64,
    },
  };
  const limits = hostWireLimits(funded, executions, { envelopeBytes: 1024 * 1024, connections: 2, requests: 4 });
  const bundle = join(directory, 'bundle');

  const build = async (root: string, offer: Offer): Promise<ArtifactManifest> => {
    let holder = HOLDER_BINARY;
    if (offer.holder === 'distinct') {
      holder = join(directory, `holder-${offer.build}`);
      copyFileSync(HOLDER_BINARY, holder);
      const signed = await spawned(['/usr/bin/codesign', '--force', '-s', '-', '-i', `tagma.holder.${offer.build}`, holder]);
      if (signed.exitCode !== 0) throw new Error(`the distinct holder could not be signed: ${signed.stderr}`);
    }
    const answer = await run(copyBundle(root, offer.build));
    let manifest = answer.manifest;
    if (offer.holder === 'distinct') manifest = rewritten(root, manifest, HOLDER_PART, readFileSync(holder));
    if (offer.holder === 'refusing') manifest = rewritten(root, manifest, HOLDER_PART, new TextEncoder().encode('#!/bin/sh\nexit 3\n'));
    if (offer.logic !== undefined && offer.logic !== 'working') {
      const host = manifest.parts.find((part) => part.role === 'host')!.path;
      const script =
        offer.logic === 'store-repair' || offer.logic === 'over-store-ahead'
          ? (offer.logic === 'store-repair' ? STORE_REPAIR : AHEAD_ROW) + readFileSync(join(root, host), 'utf8')
          : offer.logic === 'boot-exit'
            ? `require('node:fs').writeFileSync(${JSON.stringify(join(directory, `${offer.build}.exited`))}, ''); process.exit(3);\n`
            : STORE_AHEAD;
      manifest = rewritten(root, manifest, host, new TextEncoder().encode(script));
    }
    const host = manifest.parts.find((part) => part.role === 'host')!.path;
    manifest = rewritten(
      root,
      manifest,
      host,
      new TextEncoder().encode(
        `require('node:fs').appendFileSync(${JSON.stringify(join(directory, 'endpoints-found'))}, require('node:fs').existsSync(${JSON.stringify(registration.endpoint.path)}) ? 'named\\n' : 'absent\\n');\n` +
          readFileSync(join(root, host), 'utf8'),
      ),
    );
    const boot = bootPath(directory, manifest.identity.digest);
    writeFileSync(
      boot,
      Schema.encodeSync(Schema.fromJsonString(HostBoot))({
        state: directory,
        registration,
        library: join(bundle, LIBRARY_PART),
        policy: funded,
        share: hostShare(funded, executions),
        limits,
        lifetime: 'with-parent',
        artifact: bundle,
      }),
      { mode: 0o600 },
    );
    return manifest;
  };

  const stage = async (offer: Offer) => {
    const root = join(directory, `offer-${offer.build}`);
    await build(root, offer);
    return () => {
      rmSync(join(directory, 'bundle.next'), { recursive: true, force: true });
      renameSync(root, join(directory, 'bundle.next'));
    };
  };

  const standing = await build(bundle, { build: 'standing' });
  const child = Bun.spawn(
    [
      join(bundle, HOLDER_PART),
      directory,
      join(bundle, 'bun'),
      join(bundle, 'host/host.js'),
      bootPath(directory, standing.identity.digest),
    ],
    { cwd: directory, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );

  let output = '';
  let servings = 0;
  const waiters = new Set<() => void>();
  const read = async (stream: ReadableStream<Uint8Array>) => {
    let pending = '';
    for await (const bytes of stream) {
      const text = Buffer.from(bytes).toString();
      output += text;
      for (const wake of [...waiters]) wake();
      pending += text;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line.includes(registration.endpoint.path)) {
          servings += 1;
          for (const wake of [...waiters]) wake();
        }
      }
    }
  };
  const reading = Promise.all([read(child.stdout), read(child.stderr)]);
  const reported = (found: () => boolean, what: string) =>
    new Promise<void>((resume, refuse) => {
      const wake = () => {
        if (!found()) return;
        waiters.delete(wake);
        resume();
      };
      waiters.add(wake);
      wake();
      void child.exited.then((code) => {
        waiters.delete(wake);
        refuse(new Error(`the holder exited ${code} before ${what}: ${output.slice(-4000)}`));
      });
    });
  const servedAfter = (seen: number) => reported(() => servings > seen, 'its logic served');
  const heard = (text: string) => reported(() => output.includes(text), `reporting ${JSON.stringify(text)}`);

  const scope = Scope.makeUnsafe();
  const resumes: string[] = [];
  const found: string[] = [];
  let serial = 0;
  const operation = () =>
    Schema.decodeUnknownSync(HostRequestRef)({ installation: registration.installation, operation: `stand-${++serial}` });
  try {
    await servedAfter(0);
    const client = await run(
      Scope.provide(
        ExecutionClient.make({
          address: { state: directory, installation: registration.installation },
          role: 'custodian',
          limits,
          budget: {},
        }),
        scope,
      ).pipe(Effect.provide(HostRegistration.layer), Effect.provide(endpointConnection), Effect.provide(BunServices.layer)),
    );
    const take = async () => {
      const standingCustody = await run(client.status());
      found.push(standingCustody.custody.holder === undefined ? 'free' : 'held');
      const taken = await run(client.take(operation(), standingCustody.custody.revision));
      if (taken._tag !== 'Held') throw new Error(`the logic could not be taken: ${taken._tag}`);
    };
    await take();
    const served = async () => {
      await servedAfter(servings);
      await take();
    };
    const logicPid = async () => {
      const found = await spawned(['/usr/bin/pgrep', '-P', String(child.pid), '-f', 'host/host.js']);
      const pids = found.stdout
        .trim()
        .split('\n')
        .map(Number)
        .filter((pid) => pid > 0);
      if (pids.length !== 1) throw new Error(`the stand could not identify its logic: ${JSON.stringify(found)}`);
      return pids[0]!;
    };
    const prepare = async () => run(client.prepare(operation()));
    const away = async () => {
      const quiesced = await run(client.quiesce(operation()));
      if (quiesced._tag === 'Refused') throw new Error(`the logic refused to quiesce: ${quiesced.refusal._tag}`);
      const yielding = await run(client.yield(quiesced.ticket));
      if (yielding._tag !== 'Yielding') throw new Error(`the logic did not yield: ${JSON.stringify(yielding)}`);
      const resumed = await run(Effect.result(client.resume(quiesced.ticket)));
      resumes.push(resumed._tag === 'Success' ? resumed.success._tag : resumed.failure._tag);
    };
    const yielded = async (prepared: PrepareAnswer) => {
      const next = servedAfter(servings);
      await away();
      await next;
      await take();
      return prepared;
    };
    return {
      client,
      directory,
      holderPid: child.pid,
      operation,
      logicPid,
      offer: async (offer) => (await stage(offer))(),
      stage,
      prepare,
      change: async () => {
        const prepared = await prepare();
        if (prepared._tag !== 'Prepared') return prepared;
        return yielded(prepared);
      },
      away,
      signalLogic: async () => {
        process.kill(await logicPid(), 'SIGUSR2');
      },
      killLogic: async () => {
        const pid = await logicPid();
        const next = servedAfter(servings);
        process.kill(pid, 'SIGKILL');
        await next;
        await take();
      },
      served,
      heard,
      output: () => output,
      resumes: () => resumes,
      custodyFound: () => found,
      endpointsFound: () => readFileSync(join(directory, 'endpoints-found'), 'utf8').trim().split('\n'),
      dispose: async () => {
        try {
          if (child.exitCode === null) await run(client.shutdown(operation()).pipe(Effect.ignore));
        } finally {
          await run(Scope.close(scope, Exit.void));
          if (child.exitCode === null) child.kill('SIGKILL');
          await child.exited;
          await reading;
          if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    await child.exited;
    await run(Scope.close(scope, Exit.void));
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
};
