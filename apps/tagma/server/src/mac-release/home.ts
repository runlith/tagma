const PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const REGISTERED = /^path:\s+(.+?) \(0x[0-9a-f]+\)$/gmu;

export const isolatedHome = (home: string, tmp: string, user: string): Record<string, string> => ({
  PATH,
  HOME: home,
  CFFIXED_USER_HOME: home,
  TMPDIR: `${tmp}/`,
  USER: user,
  LOGNAME: user,
});

type Forgotten = { readonly forgotten: number; readonly failed: readonly string[] };

export const forgetRegistered = async (dir: string): Promise<Forgotten> => {
  const dumping = Bun.spawn([LSREGISTER, '-dump'], { stdout: 'pipe', stderr: 'ignore' });
  const [dump, dumped] = await Promise.all([new Response(dumping.stdout).text(), dumping.exited]);
  if (dumped !== 0) return { forgotten: 0, failed: [`lsregister -dump exited ${dumped}, so the registrations under ${dir} were not read`] };
  const registered = [...dump.matchAll(REGISTERED)].map((match) => match[1]!).filter((path) => path.startsWith(`${dir}/`));
  const failed: string[] = [];
  for (const bundle of registered) {
    const code = await Bun.spawn([LSREGISTER, '-u', bundle], { stdout: 'ignore', stderr: 'ignore' }).exited;
    if (code !== 0) failed.push(`${bundle} (lsregister -u exited ${code})`);
  }
  return { forgotten: registered.length - failed.length, failed };
};
