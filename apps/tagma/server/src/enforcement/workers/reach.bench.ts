import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Config } from '@runlith/tagma/rules';
import type { Assembled } from '@tagma/inspection/builtins';
import { BUILTINS } from '@tagma/inspection/builtins';
import { Schema } from 'effect';
import type { InspectionAnswer } from './asks.js';

const root = resolve(import.meta.dir, '../../../../../..');
const { default: config }: { default: Config } = await import(join(root, 'tagma.config.ts'));
const key = process.argv[2] ?? 'names';
const git = (args: readonly string[], cwd = root, env = process.env, stdin?: string): string => {
  const ran = Bun.spawnSync(['git', ...args], { cwd, env, stdin: stdin === undefined ? undefined : Buffer.from(stdin) });
  if (ran.exitCode !== 0) throw new Error(ran.stderr.toString());
  return ran.stdout.toString().trim();
};
const commit = git(['rev-parse', process.argv[3] ?? 'HEAD']);
const isolated = mkdtempSync(join(tmpdir(), 'inspection-reach-bench-'));
const started = performance.now();
const cpu = process.cpuUsage();
let rss = 0;
const sample = () => {
  rss = Math.max(rss, process.memoryUsage().rss);
};
sample();
const timer = setInterval(sample, 20);
console.log(JSON.stringify({ key, commit, bun: Bun.version, cores: cpus().length, memory: totalmem(), load: loadavg() }));
try {
  if (key !== 'dead-code') {
    const declared = config.inspections?.[key];
    if (declared === undefined || !('builtin' in declared)) throw new Error(`no builtin ${key}`);
    const builtin = declared.builtin as keyof typeof BUILTINS;
    const inspection = { builtin, params: Schema.decodeUnknownSync(BUILTINS[builtin].params)(declared.params) } as Assembled;
    const worker = new Worker(new URL('./reach.bench.worker.ts', import.meta.url), {
      workerData: { id: 1, kind: 'reach', root, commit, cacheRoot: isolated, inspection, places: [''] },
    });
    const reply = await new Promise<{ reply: InspectionAnswer; heap: number }>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    sample();
    console.log(
      JSON.stringify({
        workerHeapSampledPeak: reply.heap,
        answer: reply.reply.answered
          ? { ms: reply.reply.ms, findings: 'verdict' in reply.reply ? reply.reply.verdict.violations.length : null }
          : reply.reply,
      }),
    );
    await worker.terminate();
  } else if (key === 'dead-code') {
    const environment = {
      ...process.env,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: git(['rev-parse', '--path-format=absolute', '--git-path', 'objects']),
    };
    git(['init', '--bare', '-q', isolated]);
    const inspection = config.inspections?.['dead-code'];
    if (inspection === undefined || !('program' in inspection) || !('params' in inspection)) throw new Error('dead-code is not a program');
    const run = async (label: string, tree: string, base: string | null, paths: readonly string[] | null) => {
      const input = {
        mode: 'measure',
        request: 'bench',
        checker: 'bench',
        root: isolated,
        tree,
        base,
        workdir: isolated,
        keys: [{ key: 'dead-code', id: 'dead-code', params: inspection.params, reach: { places: [''] } }],
        sides: [{ side: 'tree', paths }, ...(base === null ? [] : [{ side: 'base', paths }])],
      };
      const began = performance.now();
      const child = Bun.spawn(
        [
          process.execPath,
          '--preload',
          join(import.meta.dir, 'reach.bench.preload.ts'),
          join(import.meta.dir, '../programs/runner.ts'),
          join(root, 'checks/law/programs.ts'),
        ],
        {
          cwd: isolated,
          env: environment,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) throw new Error(`${exitCode}: ${stderr}`);
      const reply = JSON.parse(stdout);
      if (reply.failure !== undefined) throw new Error(reply.failure);
      const usage = child.resourceUsage();
      const reading = reply.readings[0];
      console.log(
        JSON.stringify({
          label,
          wallMs: performance.now() - began,
          childRssPeak: usage?.maxRSS,
          childCpuMs: usage === undefined ? null : Number(usage.cpuTime.total) / 1000,
          childHeap: stderr.trim(),
          findings: reading.findings.length,
          coverage: reading.covered,
          remeasure: reading.remeasure,
        }),
      );
      return reading;
    };
    const seeded = await run('cold whole reach', commit, null, null);
    const mode = process.argv[4];
    if (mode !== undefined) {
      if (mode !== 'whole' && mode !== 'delta') throw new Error('pass whole or delta');
      if (mode === 'delta' && seeded.remeasure !== 'delta') throw new Error('the reader did not declare delta remeasurement');
      const path = 'apps/tagma/server/src/enforcement/rules/measure.ts';
      git(['read-tree', commit], isolated, environment);
      const blob = git(['hash-object', '-w', '--stdin'], isolated, environment, `${git(['show', `${commit}:${path}`])}\n\n`);
      git(['update-index', '--cacheinfo', '100644', blob, path], isolated, environment);
      const changed = git(['write-tree'], isolated, environment);
      await run(`one-file ${mode}`, changed, mode === 'delta' ? commit : null, [path]);
    }
  } else throw new Error(`unknown inspection ${key}`);
} finally {
  clearInterval(timer);
  const used = process.cpuUsage(cpu);
  console.log(
    JSON.stringify({ wallMs: performance.now() - started, servingCpuMs: (used.user + used.system) / 1000, servingRssSampledPeak: rss }),
  );
  rmSync(isolated, { recursive: true, force: true });
}
