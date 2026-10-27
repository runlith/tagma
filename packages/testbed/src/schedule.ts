import { ADMITTED_ENV, budgetRoot, freeUnits } from './slots.ts';

const POLL_MS = 250;
const GRANTED = /testbed: \d+ of \d+ processes/;

export type Job = {
  readonly id: string;
  readonly cwd: string;
  readonly stages: readonly (readonly string[])[];
  readonly need: number;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export type Ended = {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly alone: boolean;
  readonly interrupted: boolean;
};

export type Schedule = {
  readonly budget: number;
  readonly serial: boolean;
  readonly limit?: number;
  readonly started?: (job: Job) => void;
  readonly output?: (job: Job, chunk: Uint8Array) => void;
  readonly ended: (job: Job, run: Ended) => void;
};

export const runJobs = async (jobs: readonly Job[], schedule: Schedule): Promise<{ readonly interrupted: boolean }> => {
  const waiting = [...jobs];
  const running = new Map<string, Promise<void>>();
  const children = new Set<ReturnType<typeof Bun.spawn>>();
  let interrupted = false;
  let failure: { readonly error: unknown } | undefined;
  const failed = () => failure;
  const stop = (): void => {
    interrupted = true;
    for (const child of children) child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const launch = (job: Job, alone: boolean): { readonly granted: Promise<void>; readonly finished: Promise<void> } => {
    schedule.started?.(job);
    let grant = (): void => undefined;
    const granted = new Promise<void>((resolve) => {
      grant = resolve;
    });
    const finished = (async () => {
      let stdout = '';
      let stderr = '';
      let exit = 0;
      for (const stage of job.stages) {
        if (interrupted) break;
        const child = Bun.spawn([...stage], { cwd: job.cwd, stdout: 'pipe', stderr: 'pipe', env: { ...job.env, [ADMITTED_ENV]: '1' } });
        children.add(child);
        const collect = async (stream: ReadableStream<Uint8Array>, grants: boolean): Promise<string> => {
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let text = '';
          for (;;) {
            const read = await reader.read();
            if (read.done) break;
            if (failure === undefined) {
              try {
                schedule.output?.(job, read.value);
              } catch (error) {
                failure = { error };
                stop();
              }
            }
            text += decoder.decode(read.value, { stream: true });
            if (grants && GRANTED.test(text)) grant();
          }
          return text + decoder.decode();
        };
        const [out, err, code] = await Promise.all([collect(child.stdout, false), collect(child.stderr, true), child.exited]);
        children.delete(child);
        stdout += out;
        stderr += err;
        exit = code;
        if (code !== 0) break;
      }
      const stopped = failed();
      if (stopped !== undefined) throw stopped.error;
      grant();
      running.delete(job.id);
      schedule.ended(job, { exit, stdout, stderr, alone, interrupted });
    })();
    return { granted, finished };
  };
  try {
    let started = 0;
    while (!interrupted) {
      if (started < (schedule.limit ?? Infinity) && waiting.length > 0 && running.size < (schedule.serial ? 1 : Infinity)) {
        const free = running.size === 0 ? schedule.budget : freeUnits(budgetRoot(), schedule.budget);
        const at = running.size === 0 ? 0 : waiting.findIndex((job) => Math.max(1, Math.min(job.need, schedule.budget)) <= free);
        if (at !== -1) {
          const job = waiting.splice(at, 1)[0]!;
          const { granted, finished } = launch(job, running.size === 0);
          running.set(job.id, finished);
          started++;
          await Promise.race([granted, finished]);
          continue;
        }
      }
      if (running.size === 0) break;
      await Promise.race([...running.values(), Bun.sleep(POLL_MS)]);
    }
    await Promise.all(running.values());
    return { interrupted };
  } catch (error) {
    stop();
    await Promise.allSettled([...running.values(), ...[...children].map((child) => child.exited)]);
    const stopped = failed();
    throw stopped === undefined ? error : stopped.error;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
};
