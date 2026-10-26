#!/usr/bin/env bun

import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer } from 'effect';
import { resolve } from 'node:path';
import { run } from './typecheck.js';

const target = resolve(process.cwd(), process.argv[2] ?? '.');

const host = Layer.mergeAll(
  BunFileSystem.layer,
  BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);

BunRuntime.runMain(run(target).pipe(Effect.provide(host)));
