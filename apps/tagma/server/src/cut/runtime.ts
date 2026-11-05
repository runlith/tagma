import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';

export const OFFICIAL_RUNTIMES = 'https://github.com/oven-sh/bun/releases/download';

export type RuntimeTrouble = { readonly detail: string; readonly unblock: readonly string[] };

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const fetched = async (url: string): Promise<Uint8Array | string> => {
  const answer = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) }).catch((error: unknown) => String(error));
  if (typeof answer === 'string') return `${url} could not be reached: ${answer}`;
  if (!answer.ok) return `${url} answered ${answer.status}`;
  return new Uint8Array(await answer.arrayBuffer());
};

const unzipped = async (zip: Uint8Array, member: string, scratch: string): Promise<Uint8Array | string> => {
  await writeFile(join(scratch, 'bun.zip'), zip);
  const child = Bun.spawn(['/usr/bin/unzip', '-p', join(scratch, 'bun.zip'), member], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [bytes, trouble, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited]);
  return code === 0 ? bytes : `${member} could not be taken from the official archive: ${trouble.trim() || `unzip exited ${code}`}`;
};

const absent = (error: NodeJS.ErrnoException): null => {
  if (error.code === 'ENOENT') return null;
  throw error;
};

const kept = async (binary: string): Promise<boolean> => {
  const [bytes, digest] = await Promise.all([readFile(binary).catch(absent), readFile(`${binary}.sha256`, 'utf8').catch(absent)]);
  return bytes !== null && digest !== null && sha256(bytes) === digest.trim();
};

const official = async (version: string, name: string, origin: string, cache: string): Promise<string | RuntimeTrouble> => {
  const home = join(cache, `bun-v${version}-${name}`);
  const binary = join(home, 'bun');
  if (await kept(binary)) return binary;
  const base = `${origin}/bun-v${version}`;
  const [sums, zip] = await Promise.all([fetched(`${base}/SHASUMS256.txt`), fetched(`${base}/${name}.zip`)]);
  const unreached = [sums, zip].find((one): one is string => typeof one === 'string');
  if (unreached !== undefined) {
    return {
      detail: `the official Bun ${version} could not be read: ${unreached}`,
      unblock: ['cut the release again once the network answers'],
    };
  }
  const named = new TextDecoder()
    .decode(sums as Uint8Array)
    .split('\n')
    .map((line) => line.trim().split(/\s+/u))
    .find((fields) => fields[1] === `${name}.zip`)?.[0];
  if (named !== sha256(zip as Uint8Array)) {
    return {
      detail: `the official ${name}.zip of Bun ${version} does not match the SHA-256 its release names`,
      unblock: ['cut the release again; if this repeats, the download is altered on its way'],
    };
  }
  await mkdir(cache, { recursive: true });
  const scratch = await mkdtemp(join(cache, `.bun-v${version}-${name}-`));
  try {
    const bytes = await unzipped(zip as Uint8Array, `${name}/bun`, scratch);
    if (typeof bytes === 'string') return { detail: bytes, unblock: [] };
    await mkdir(join(scratch, 'out'));
    await writeFile(join(scratch, 'out', 'bun'), bytes);
    await chmod(join(scratch, 'out', 'bun'), 0o755);
    await writeFile(join(scratch, 'out', 'bun.sha256'), `${sha256(bytes)}\n`);
    const placed = await rename(join(scratch, 'out'), home).then(
      () => null,
      (error: unknown) => String(error),
    );
    if (placed === null || (await kept(binary))) return binary;
    return {
      detail: `${home} holds no intact official Bun ${version}, and the one just checked could not take its place: ${placed}`,
      unblock: [`remove ${home}, then cut the release again`],
    };
  } catch (error) {
    return { detail: `the official Bun ${version} could not be kept in ${cache}: ${String(error)}`, unblock: [] };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

export const releaseRuntime = (
  checkout: string,
  running: string,
  name: string,
  cache: string,
  origin: string = OFFICIAL_RUNTIMES,
): Effect.Effect<string, RuntimeTrouble> =>
  Effect.flatMap(
    Effect.promise(async (): Promise<string | RuntimeTrouble> => {
      const workspace = join(checkout, 'package.json');
      let declared: string;
      try {
        declared = String((JSON.parse(await readFile(workspace, 'utf8')) as { readonly packageManager?: unknown }).packageManager);
      } catch (error) {
        return { detail: `${workspace} does not read: ${String(error)}`, unblock: [] };
      }
      const version = /^bun@(\d+\.\d+\.\d+)$/u.exec(declared)?.[1];
      if (version === undefined) {
        return {
          detail: `the checkout declares packageManager "${declared}", which names no Bun release`,
          unblock: ['declare "packageManager": "bun@<x.y.z>" in package.json'],
        };
      }
      if (version !== running) {
        return {
          detail: `this release would be bundled by Bun ${running}, and the checkout declares bun@${version}`,
          unblock: [`bun upgrade --version ${version}, then cut the release again`],
        };
      }
      return official(version, name, origin, cache);
    }),
    (answer) => (typeof answer === 'string' ? Effect.succeed(answer) : Effect.fail(answer)),
  );
