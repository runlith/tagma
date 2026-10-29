import { Context, Data, type Effect, type Scope } from 'effect';

export type ClipShape = { readonly file: string; readonly width: number; readonly height: number; readonly fps: number };

export class ClipFailed extends Data.TaggedError('ClipFailed')<{ readonly message: string }> {}

export type Clip = {
  readonly width: number;
  readonly height: number;
  frame(picture: string, at: number, span: number): Effect.Effect<void, ClipFailed>;
  readonly finish: Effect.Effect<void, ClipFailed>;
};

export class Clips extends Context.Service<
  Clips,
  {
    open(shape: ClipShape): Effect.Effect<Clip, ClipFailed, Scope.Scope>;
  }
>()('tagma/browser/Clips') {}
