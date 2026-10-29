import { Effect } from 'effect';
import { LSOF } from './evidence';

export type FileHolders =
  | { readonly _tag: 'Holders'; readonly pids: ReadonlyArray<number> }
  | { readonly _tag: 'Unread'; readonly detail: string };

export const fileHolders = Effect.fn('MacosHolders.of')(function* (file: string): Effect.fn.Return<FileHolders> {
  const read = yield* Effect.result(
    Effect.tryPromise(() => {
      const child = Bun.spawn([LSOF, '-t', '--', file], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    }),
  );
  if (read._tag === 'Failure') return { _tag: 'Unread', detail: `${LSOF} would not run` };
  const [listed, complained] = read.success;
  const pids = listed
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  if (pids.length === 0 && complained.trim() !== '') {
    return { _tag: 'Unread', detail: `${LSOF} could not read ${file}: ${complained.trim().split('\n')[0] ?? ''}` };
  }
  return { _tag: 'Holders', pids };
});
