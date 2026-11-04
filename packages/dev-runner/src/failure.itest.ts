import { expect, test } from 'bun:test';

const RUNNER = new URL('./index.ts', import.meta.url).href;
const DIAGNOSTIC = 'native prerequisite missing';
const SERVE = 'Bun.serve({ port: 0, fetch: () => new Response("held") });';

test('a participant exit reports its observed native failure and ends the stack while a descendant keeps stderr open', async () => {
  const native = `const descendant = Bun.spawn([process.execPath, '-e', ${JSON.stringify(SERVE)}], { stdout: 'ignore', stderr: 'inherit' });
console.log(descendant.pid);
await Bun.write(Bun.stderr, ${JSON.stringify(DIAGNOSTIC)});
await Bun.stdin.stream().getReader().read();
process.exit(17);`;
  const program = `import { runDev } from ${JSON.stringify(RUNNER)};
await runDev({ label: 'failure-probe', processes: [
  { name: 'sibling', command: process.execPath, args: ['-e', ${JSON.stringify(SERVE)}], cwd: ${JSON.stringify(import.meta.dir)} },
  { name: 'browser', command: process.execPath, args: ['-e', ${JSON.stringify(native)}], cwd: ${JSON.stringify(import.meta.dir)},
    explainFailure: (failure) => JSON.stringify({ code: failure.code, diagnostic: failure.stderr }) },
] });`;
  const child = Bun.spawn([process.execPath, '-e', program], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const stdout = new Response(child.stdout).text();
  const reader = child.stderr.getReader();
  const decoder = new TextDecoder();
  let stderr = '';
  let acknowledged = false;
  let descendant: number | undefined;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stderr += decoder.decode(chunk.value, { stream: true });
      if (!acknowledged && stderr.includes(DIAGNOSTIC)) {
        child.stdin.write('observed');
        child.stdin.end();
        acknowledged = true;
      }
    }
    descendant = Number((await stdout).trim());
    expect(await child.exited).toBe(17);
    const diagnostic = stderr.slice(stderr.indexOf('{')).trim();
    expect(JSON.parse(diagnostic)).toEqual({ code: 17, diagnostic: DIAGNOSTIC });
  } finally {
    if (descendant !== undefined) {
      try {
        process.kill(descendant, 'SIGKILL');
      } catch (failure) {
        if (!(failure instanceof Error && 'code' in failure && failure.code === 'ESRCH')) throw failure;
      }
    }
  }
});
