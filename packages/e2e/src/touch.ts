import { Data, Effect } from 'effect';

export type PagePoint = { readonly x: number; readonly y: number };
export type Touch = {
  readonly press: (point: PagePoint) => Promise<void>;
  readonly move: (point: PagePoint) => Promise<void>;
  readonly release: () => Promise<void>;
};
export type TouchPhase = 'press' | 'move' | 'release';
export type TouchInput<A extends object> = {
  readonly locate: (point: PagePoint) => Promise<A>;
  readonly send: (phase: TouchPhase, point: A) => Promise<void>;
};
export class TouchFailed extends Data.TaggedError('TouchFailed')<{ readonly message: string; readonly cause?: unknown }> {}

class Contact<A extends object> implements Touch {
  private point: A | undefined;
  private pending = Promise.resolve();
  constructor(private readonly input: TouchInput<A>) {}

  private async ordered(work: () => Promise<void>): Promise<void> {
    const previous = this.pending;
    let complete!: () => void;
    this.pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    await previous;
    try {
      await work();
    } catch (cause) {
      throw cause instanceof TouchFailed ? cause : new TouchFailed({ message: 'trusted touch input failed', cause });
    } finally {
      complete();
    }
  }

  press = (point: PagePoint): Promise<void> =>
    this.ordered(async () => {
      if (this.point !== undefined) throw new TouchFailed({ message: 'the finger is already pressed' });
      this.point = await this.input.locate(point);
      await this.input.send('press', this.point);
    });

  move = (point: PagePoint): Promise<void> =>
    this.ordered(async () => {
      if (this.point === undefined) throw new TouchFailed({ message: 'press the finger before moving it' });
      this.point = await this.input.locate(point);
      await this.input.send('move', this.point);
    });

  release = (): Promise<void> =>
    this.ordered(async () => {
      if (this.point === undefined) return;
      await this.input.send('release', this.point);
      this.point = undefined;
    });
}

export const makeTouch = Effect.fn('e2e.touch')(function* <A extends object>(input: TouchInput<A>) {
  return yield* Effect.acquireRelease(
    Effect.sync((): Touch => new Contact(input)),
    (contact) =>
      Effect.tryPromise({
        try: contact.release,
        catch: (cause) => new TouchFailed({ message: 'the active finger did not release', cause }),
      }).pipe(Effect.orDie),
  );
});
