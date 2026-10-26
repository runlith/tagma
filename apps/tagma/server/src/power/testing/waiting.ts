import { Effect, Schedule } from 'effect';

export const until = (ready: () => boolean | Promise<boolean>) =>
  Effect.promise(async () => ready()).pipe(
    Effect.flatMap((held) => (held ? Effect.void : Effect.fail('the condition never held'))),
    Effect.retry({ schedule: Schedule.spaced('10 millis'), times: 200 }),
  );

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const pidFrom = Effect.fnUntraced(function* (path: string) {
  yield* until(() => Bun.file(path).exists());
  return Number((yield* Effect.promise(() => Bun.file(path).text())).trim());
});
