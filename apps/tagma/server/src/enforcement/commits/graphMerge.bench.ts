import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, totalmem, platform, release, loadavg } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Effect } from 'effect';
import { Git, GitUnavailable, gitVerb, type GitOptions } from '@runlith/git/Git';
import { mergeTreeApart } from '@runlith/git/apart';
import { graphDriver } from './graphMerge.js';

const sizes = process.argv.slice(2).map(Number);
if (sizes.length === 0 || sizes.some((size) => !Number.isInteger(size) || size < 1)) throw new Error('Pass positive file counts');
console.log(
  JSON.stringify({
    machine: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memory: totalmem(),
      platform: platform(),
      release: release(),
      bun: Bun.version,
    },
  }),
);

for (const size of sizes) {
  const root = await mkdtemp(join(tmpdir(), 'graph-merge-bench-'));
  const commands = new Map<string, number>();
  let childCpuUs = 0;
  let active = 0;
  let parallel = 0;
  let measured = false;
  const run = async (args: readonly string[], options: GitOptions = {}) => {
    const child = Bun.spawn(['git', ...args], {
      cwd: options.cwd ?? root,
      env: options.env === undefined ? undefined : { ...process.env, ...options.env },
      stdin: options.stdin === undefined ? 'ignore' : 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (measured) {
      const verb = gitVerb(args);
      commands.set(verb, (commands.get(verb) ?? 0) + 1);
      parallel = Math.max(parallel, ++active);
    }
    if (options.stdin !== undefined && child.stdin != null) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
    const [bytes, stderr, status] = await Promise.all([
      new Response(child.stdout).bytes(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (measured) {
      active -= 1;
      const usage = child.resourceUsage();
      childCpuUs += Number(usage?.cpuTime.user ?? 0) + Number(usage?.cpuTime.system ?? 0);
    }
    return {
      status,
      stdout: options.stdoutBytes ? '' : new TextDecoder().decode(bytes),
      stdoutBytes: options.stdoutBytes ? bytes : undefined,
      stderr,
      overflow: false,
      messageOverflow: false,
    };
  };
  const git = async (...args: string[]) => {
    const answer = await run(args);
    if (answer.status !== 0) throw new Error(`git ${args.join(' ')}: ${answer.stderr}`);
    return answer.stdout.trim();
  };
  const block = (at: number, side: string) =>
    `---\nid: 0198c3d4-7b2a-7f00-8000-${at.toString(16).padStart(12, '0')}\ntitle: Block ${at}\nord: ${at}\nfields:\n  payload: ${JSON.stringify(Array.from({ length: 64 }, (_, n) => ({ name: `entry-${n}`, value: 'x'.repeat(80) })))}\n---\n${side}\n`;
  const put = async (side: string) => {
    for (let at = 0; at < size; at += 1) await writeFile(join(root, '.tagma', `${at}.md`), block(at, side));
    await git('add', '-A');
    await git('commit', '-qm', side);
    return git('rev-parse', 'HEAD');
  };
  try {
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.name', 'bench');
    await git('config', 'user.email', 'bench@test');
    await mkdir(join(root, '.tagma'));
    await writeFile(join(root, '.git', 'info', 'attributes'), '/.tagma/*.md merge=tagma-graph\n');
    const base = await put('base');
    const ours = await put('ours');
    await git('checkout', '-q', '--detach', base);
    const theirs = await put('theirs');
    const service = Git.of({
      run: (args, options) =>
        Effect.tryPromise({
          try: () => run(args, options),
          catch: (cause) => new GitUnavailable({ command: args, reason: String(cause) }),
        }),
    });
    const loop = monitorEventLoopDelay({ resolution: 1 });
    loop.enable();
    const cpu = process.cpuUsage();
    const thread = process.threadCpuUsage();
    let previous = thread;
    let tick = performance.now();
    let maxTickCpuMs = 0;
    let maxTick = { wallMs: 0, cpuMs: 0 };
    const timer = setInterval(() => {
      const now = performance.now();
      const used = process.threadCpuUsage(previous);
      const cpuMs = (used.user + used.system) / 1000;
      const wallMs = now - tick;
      if (wallMs > maxTick.wallMs) maxTick = { wallMs, cpuMs };
      maxTickCpuMs = Math.max(maxTickCpuMs, cpuMs);
      tick = now;
      previous = process.threadCpuUsage();
    }, 1);
    const loadBefore = loadavg();
    const start = performance.now();
    measured = true;
    const result = await Effect.runPromise(mergeTreeApart(service, root, ours, theirs, { driver: graphDriver }));
    measured = false;
    const wallMs = performance.now() - start;
    const used = process.cpuUsage(cpu);
    const loopCpu = process.threadCpuUsage(thread);
    clearInterval(timer);
    loop.disable();
    if (result.conflicts.length !== 0 || result.yielded.length !== size)
      throw new Error('The graph merge did not favor ours for every contested block');
    console.log(
      JSON.stringify({
        files: size,
        loadBefore,
        loadAfter: loadavg(),
        wallMs,
        processCpuMs: (used.user + used.system) / 1000,
        childCpuMs: childCpuUs / 1000,
        totalCpuMs: (used.user + used.system + childCpuUs) / 1000,
        loopMaxMs: loop.max / 1e6,
        loopP99Ms: loop.percentile(99) / 1e6,
        loopCpuMs: (loopCpu.user + loopCpu.system) / 1000,
        maxTickCpuMs,
        maxTick,
        parallel,
        commands: Object.fromEntries(commands),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
