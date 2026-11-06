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

export const forgetRegistered = async (dir: string): Promise<number> => {
  const dump = await new Response(Bun.spawn([LSREGISTER, '-dump'], { stdout: 'pipe', stderr: 'ignore' }).stdout).text();
  const registered = [...dump.matchAll(REGISTERED)].map((match) => match[1]!).filter((path) => path.startsWith(`${dir}/`));
  for (const bundle of registered) await Bun.spawn([LSREGISTER, '-u', bundle], { stdout: 'ignore', stderr: 'ignore' }).exited;
  return registered.length;
};
