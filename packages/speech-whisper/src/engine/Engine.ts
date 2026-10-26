import { Context, Duration, Effect, Layer, type Scope } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { makeClips, type Model, type Transcript } from './clips.ts';
import { type DetectionLimits, detect, type EngineDetection } from './detection.ts';
import type { EngineFailure, ModelBusy, QueueFull } from './failures.ts';
import { makeHost } from './host.ts';
import type { EnginePaths } from './spawn.ts';

export type EngineOptions = {
  readonly readyWithin?: Duration.Input;
  readonly queueMs?: number;
  readonly idle?: Duration.Input;
  readonly detection?: DetectionLimits;
};

const detectionDefaults: DetectionLimits = { aheadMs: 10_000, unread: 256 };

const COLD_START = Duration.minutes(2);

const engineRate = 16_000;

export class Engine extends Context.Service<
  Engine,
  {
    readonly transcribe: (
      model: Model,
      pcm: Int16Array,
      language: string | undefined,
    ) => Effect.Effect<Transcript, EngineFailure | QueueFull | ModelBusy>;
    readonly detect: Effect.Effect<EngineDetection, EngineFailure, Scope.Scope>;
  }
>()('speech-whisper/Engine') {
  static layer(paths: EnginePaths, options: EngineOptions = {}): Layer.Layer<Engine, never, ChildProcessSpawner.ChildProcessSpawner> {
    return Layer.effect(
      Engine,
      Effect.gen(function* () {
        const host = yield* makeHost({ paths, within: options.readyWithin ?? COLD_START });
        const clips = makeClips({
          host,
          rate: engineRate,
          budgetMs: options.queueMs ?? 120_000,
          idle: options.idle ?? Duration.minutes(5),
        });
        yield* Effect.forkScoped(clips.work);
        return Engine.of({
          transcribe: clips.transcribe,
          detect: detect(host, options.detection ?? detectionDefaults),
        });
      }),
    );
  }
}
