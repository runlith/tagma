#!/usr/bin/env bun

import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Effect, Layer } from 'effect';
import { resolve } from 'node:path';
import { run } from './typecheck.js';

const args = process.argv.slice(2);
const project = args[0] === '--project';
const target = resolve(process.cwd(), (project ? args[1] : args[0]) ?? '.');
const invalid = project && (args.length !== 2 || args[1] === '');

const host = Layer.mergeAll(
  BunFileSystem.layer,
  BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
);

BunRuntime.runMain((invalid ? Effect.fail(new Error('Usage: runlith-typecheck [directory | --project <tsconfig>]')) : run(target, project)).pipe(Effect.provide(host)));
