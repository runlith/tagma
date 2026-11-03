#!/usr/bin/env bun

import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer } from 'effect';
import { resolve } from 'node:path';
import { type Reach, run } from './typecheck.js';

const args = process.argv.slice(2);
const reach: Reach = args[0] === '--project' ? 'project' : args[0] === '--no-dependencies' ? 'scope' : 'closure';
const target = resolve(process.cwd(), (reach === 'closure' ? args[0] : args[1]) ?? '.');
const invalid = reach === 'project' && (args.length !== 2 || args[1] === '');

const host = Layer.mergeAll(
  BunFileSystem.layer,
  BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);

BunRuntime.runMain(
  (invalid
    ? Effect.fail(new Error('Usage: runlith-typecheck [--no-dependencies] [directory] | --project <tsconfig>'))
    : run(target, reach)
  ).pipe(Effect.provide(host)),
);
