import { createHash } from 'node:crypto';
import { Clock, Context, Effect, FileSystem, Layer, Path, Result, Schema, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import { type ModelArtifact, models } from './catalog.ts';
import { download, fold } from './download.ts';
import { DownloadFailed, InstallBusy, type InstallFailure, IntegrityFailed, ModelMissing, ModelUnknown, StoreFailed } from './failures.ts';

const Receipt = Schema.Struct({
  model: Schema.String,
  url: Schema.String,
  size: Schema.Int,
  sha256: Schema.String,
  installedAt: Schema.String,
});
const ReceiptJson = Schema.fromJsonString(Receipt);
const decodeReceipt = Schema.decodeUnknownEffect(ReceiptJson);
const encodeReceipt = Schema.encodeUnknownEffect(ReceiptJson);

export type InstalledModel = {
  readonly id: string;
  readonly path: string;
};

export type ModelState = {
  readonly artifact: ModelArtifact;
  readonly installed: boolean;
  readonly partial: number;
};

export type Progress = {
  readonly model: string;
  readonly received: number;
  readonly size: number;
};

const stored = (failure: { readonly message: string }) => new StoreFailed({ reason: failure.message });

export class ModelStore extends Context.Service<
  ModelStore,
  {
    readonly artifacts: ReadonlyArray<ModelArtifact>;
    readonly list: Effect.Effect<ReadonlyArray<ModelState>, StoreFailed>;
    readonly installed: (model: string) => Effect.Effect<InstalledModel, ModelUnknown | ModelMissing | StoreFailed>;
    readonly install: (model: string) => Stream.Stream<Progress, InstallFailure>;
    readonly remove: (model: string) => Effect.Effect<void, ModelUnknown | InstallBusy | StoreFailed>;
  }
>()('speech-whisper/ModelStore') {
  static layer(
    root: string,
    artifacts: ReadonlyArray<ModelArtifact> = models,
  ): Layer.Layer<ModelStore, never, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient> {
    return Layer.effect(
      ModelStore,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* HttpClient.HttpClient;
        const installing = new Set<string>();
        const finalDir = (artifact: ModelArtifact) => path.join(root, artifact.id);
        const partialDir = (artifact: ModelArtifact) => path.join(root, `${artifact.id}.partial`);
        const modelFile = (artifact: ModelArtifact) => path.join(finalDir(artifact), 'model.bin');
        const partialFile = (artifact: ModelArtifact) => path.join(partialDir(artifact), 'model.bin');
        const erase = (target: string) => fs.remove(target, { recursive: true, force: true });
        const find = (model: string) => {
          const artifact = artifacts.find((one) => one.id === model);
          return artifact === undefined ? Effect.fail(new ModelUnknown({ model })) : Effect.succeed(artifact);
        };
        const sizeOf = Effect.fnUntraced(function* (file: string) {
          if (!(yield* Effect.mapError(fs.exists(file), stored))) return 0;
          return Number((yield* Effect.mapError(fs.stat(file), stored)).size);
        });
        const holds = Effect.fnUntraced(function* (artifact: ModelArtifact) {
          const receiptFile = path.join(finalDir(artifact), 'receipt.json');
          if (!(yield* Effect.mapError(fs.exists(receiptFile), stored))) return false;
          const text = yield* Effect.mapError(fs.readFileString(receiptFile), stored);
          const receipt = yield* Effect.result(decodeReceipt(text));
          if (Result.isFailure(receipt)) {
            yield* Effect.logWarning('the model receipt does not decode, the model counts as not installed', {
              receiptFile,
              cause: receipt.failure,
            });
            return false;
          }
          const { model, url, size, sha256 } = receipt.success;
          if (model !== artifact.id || url !== artifact.url || size !== artifact.size || sha256 !== artifact.sha256) return false;
          return (yield* sizeOf(modelFile(artifact))) === artifact.size;
        });
        const claim = Effect.fnUntraced(function* (artifact: ModelArtifact) {
          if (installing.has(artifact.id)) return yield* new InstallBusy({ installing: artifact.id });
          installing.add(artifact.id);
        });
        const publish = Effect.fnUntraced(function* (artifact: ModelArtifact, streamed: string | undefined) {
          const file = partialFile(artifact);
          const size = yield* sizeOf(file);
          if (size !== artifact.size) {
            return yield* new DownloadFailed({ model: artifact.id, reason: `the download ended at ${size} of ${artifact.size} bytes` });
          }
          const digest = streamed ?? (yield* fold(fs, file, createHash('sha256'))).digest('hex');
          if (digest !== artifact.sha256) {
            yield* Effect.mapError(erase(file), stored);
            return yield* new IntegrityFailed({ model: artifact.id, reason: 'its SHA-256 does not match the pinned one' });
          }
          const receipt = yield* Effect.mapError(
            encodeReceipt({
              model: artifact.id,
              url: artifact.url,
              size,
              sha256: digest,
              installedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            }),
            stored,
          );
          yield* Effect.mapError(fs.writeFileString(path.join(partialDir(artifact), 'receipt.json'), receipt), stored);
          yield* Effect.uninterruptible(
            Effect.mapError(Effect.andThen(erase(finalDir(artifact)), fs.rename(partialDir(artifact), finalDir(artifact))), stored),
          );
        });
        return ModelStore.of({
          artifacts,
          list: Effect.forEach(artifacts, (artifact) =>
            Effect.all({ installed: holds(artifact), partial: sizeOf(partialFile(artifact)) }).pipe(
              Effect.map(({ installed, partial }) => ({ artifact, installed, partial })),
            ),
          ),
          installed: Effect.fnUntraced(function* (model) {
            const artifact = yield* find(model);
            if (!(yield* holds(artifact))) return yield* new ModelMissing({ model });
            return { id: artifact.id, path: modelFile(artifact) };
          }),
          remove: Effect.fnUntraced(function* (model) {
            const artifact = yield* find(model);
            if (installing.has(artifact.id)) return yield* new InstallBusy({ installing: artifact.id });
            yield* Effect.mapError(Effect.andThen(erase(finalDir(artifact)), erase(partialDir(artifact))), stored);
          }),
          install: (model) =>
            Stream.unwrap(
              Effect.gen(function* () {
                const artifact = yield* find(model);
                const progress = (received: number): Progress => ({ model: artifact.id, received, size: artifact.size });
                if (yield* holds(artifact)) return Stream.make(progress(artifact.size));
                yield* Effect.acquireRelease(claim(artifact), () => Effect.sync(() => installing.delete(artifact.id)));
                yield* Effect.mapError(fs.makeDirectory(partialDir(artifact), { recursive: true }), stored);
                let have = yield* sizeOf(partialFile(artifact));
                if (have > artifact.size) {
                  yield* Effect.mapError(erase(partialFile(artifact)), stored);
                  have = 0;
                }
                let digest: string | undefined;
                const fetched =
                  have === artifact.size
                    ? Stream.empty
                    : download(fs, client, artifact, partialFile(artifact), have).pipe(
                        Stream.map((received) => {
                          if (received.digest !== undefined) digest = received.digest;
                          return received.bytes;
                        }),
                      );
                let shown = -1;
                const visible = (received: number) => {
                  const percent = Math.floor((received * 100) / artifact.size);
                  if (percent === shown) return false;
                  shown = percent;
                  return true;
                };
                return Stream.make(have).pipe(
                  Stream.concat(fetched),
                  Stream.filter(visible),
                  Stream.map(progress),
                  Stream.concat(Stream.fromEffectDrain(Effect.suspend(() => publish(artifact, digest)))),
                );
              }),
            ),
        });
      }),
    );
  }
}
