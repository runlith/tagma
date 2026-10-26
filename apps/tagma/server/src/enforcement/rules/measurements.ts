import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Git } from '@runlith/git/Git';
import { treeIdAt } from '@runlith/git/trees';
import { troubleOf } from '@runlith/git/repository';
import { Effect, Option, Schema } from 'effect';
import { actingGit, runGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Measurement, type MeasurementIdentity } from '../contract/wire/enforcement.js';
import type { Law } from '../contract/wire/document.js';
import { digest } from './revision.js';

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Measurement));

export const declarationOf = (document: Law, places: readonly string[]): string => digest({ document, places });

export const measuredAs = (measurement: Measurement | undefined, identity: MeasurementIdentity): boolean =>
  identity.implementation !== undefined &&
  measurement?.identity?.tree === identity.tree &&
  measurement.identity.declaration === identity.declaration &&
  measurement.identity.implementation === identity.implementation;

export const treeOf = Effect.fn('enforcement.measurementTree')(function* (root: string, commit: string) {
  return yield* treeIdAt(actingGit(yield* Git, 'enforcement-measurements'), root, commit).pipe(
    Effect.mapError((failure) => unkept(root, troubleOf(failure))),
  );
});

const unkept = (root: string, reason: string) =>
  new GateRefusal('inspection-failed', `the measurements of ${root} could not be read or kept: ${reason}`, [
    "read the reason: the checkout's git directory holds them under tagma/measured, and the next measurement writes them again",
  ]);

const said = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const textAt = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw failure;
  }
};

const shelfOf = Effect.fn('enforcement.measurementShelf')(function* (root: string) {
  const answer = yield* runGit(yield* Git, 'enforcement-measurements', ['-C', root, 'rev-parse', '--git-path', 'tagma/measured']).pipe(
    Effect.mapError((failure) => unkept(root, failure.message)),
  );
  return resolve(root, answer.trim());
});

export const measurementsOf = Effect.fn('enforcement.measurementsOf')(function* (
  root: string,
  rules: readonly string[],
  read: string | undefined = undefined,
) {
  const shelf = read ?? (yield* shelfOf(root));
  const texts = yield* Effect.tryPromise({
    try: () => Promise.all(rules.map((rule) => textAt(join(shelf, `${rule}.json`)))),
    catch: (failure) => unkept(root, said(failure)),
  });
  const found = new Map<string, Measurement>();
  texts.forEach((text, at) => {
    const read = text === null ? Option.none() : decode(text);
    if (Option.isSome(read)) found.set(rules[at]!, read.value);
  });
  return found as ReadonlyMap<string, Measurement>;
});

export const keepMeasurement = Effect.fn('enforcement.keepMeasurement')(function* (
  root: string,
  rule: string,
  measurement: Measurement,
  read: string | undefined = undefined,
) {
  const shelf = read ?? (yield* shelfOf(root));
  const path = join(shelf, `${rule}.json`);
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(shelf, { recursive: true });
      const written = `${path}.${randomUUID()}`;
      await writeFile(written, `${JSON.stringify(measurement)}\n`);
      await rename(written, path);
    },
    catch: (failure) => unkept(root, said(failure)),
  });
});
