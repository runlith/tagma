const STOP_GRACE_MS = 10_000;
const KILL_GRACE_MS = 2_000;
const STOP_POLL_MS = 100;

const signalGroup = (group: number, signal: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(-group, signal);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const groupGone = async (group: number, within: number): Promise<boolean> => {
  for (let waited = 0; waited < within; waited += STOP_POLL_MS) {
    if (!signalGroup(group, 0)) return true;
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  return !signalGroup(group, 0);
};

const printed = async (argv: readonly string[]): Promise<string | null> => {
  try {
    const child = Bun.spawn([...argv], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? text : null;
  } catch {
    return null;
  }
};

const descendantsOf = async (group: number): Promise<readonly number[]> => {
  const listed = await printed(['ps', '-A', '-o', 'pid=,ppid=,pgid=']);
  if (listed === null) return [];
  const rows = listed
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row): row is [number, number, number] => row.length === 3 && row.every(Number.isInteger));
  const found = new Set(rows.filter(([, , pgid]) => pgid === group).map(([pid]) => pid));
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid);
        grew = true;
      }
    }
  }
  return [...found];
};

export const endGroup = async (group: number): Promise<void> => {
  signalGroup(group, 'SIGTERM');
  if (await groupGone(group, STOP_GRACE_MS)) return;
  const descendants = await descendantsOf(group);
  signalGroup(group, 'SIGKILL');
  for (const pid of descendants) {
    signalGroup(pid, 'SIGKILL');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  await groupGone(group, KILL_GRACE_MS);
};

export const commandOf = async (pid: number): Promise<string | null> =>
  (await printed(['ps', '-o', 'command=', '-p', String(pid)]))?.trim() ?? null;
