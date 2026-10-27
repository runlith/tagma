import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Applications } from '../installation/contract/service/applications.js';
import { RELEASE_INSIDE } from '../installation/contract/wire/layout.js';
import { DESKTOP } from '../installation/contract/wire/manifest.js';
import { currentVersion } from '../installation/closure/versions.js';
import { requireFree, treeBytes } from '../platform/durable/space.js';

const CODESIGN = '/usr/bin/codesign';
const XATTR = '/usr/bin/xattr';
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const QUARANTINE = 'com.apple.quarantine';

const carriedRelease = (bundle: string): string => join(bundle, RELEASE_INSIDE);

export const carrierOf = (dir: string): string | null => {
  const suffix = `/${RELEASE_INSIDE}`;
  const bundle = dir.endsWith(suffix) ? dir.slice(0, -suffix.length) : null;
  return bundle !== null && bundle.endsWith('.app') ? bundle : null;
};

const keptApplication = (root: string): string | undefined => {
  const kept = join(root, DESKTOP);
  if (!existsSync(kept)) return undefined;
  const found = readdirSync(kept).filter((name) => name.endsWith('.app'));
  return found.length === 1 ? join(kept, found[0]!) : undefined;
};

const ran = (args: readonly string[]): Promise<number | null> =>
  new Promise((ended) => {
    const child = spawn('/bin/cp', [...args], { stdio: 'ignore' });
    child.on('error', () => ended(null));
    child.on('exit', (code) => ended(code));
  });

const cloned = async (from: string, to: string): Promise<void> => {
  if ((await ran(['-Rc', from, to])) === 0) return;
  await rm(to, { recursive: true, force: true });
  requireFree(dirname(to), treeBytes(from));
  const code = await ran(['-R', from, to]);
  if (code === 0) return;
  await rm(to, { recursive: true, force: true });
  throw new Error(`${from} could not be copied to ${to}: cp exited ${code ?? 'without starting'}`);
};

const beside = (target: string, part: 'incoming' | 'outgoing'): string => join(dirname(target), `.${basename(target)}.${part}`);

export const recoverBundle = async (target: string): Promise<void> => {
  const outgoing = beside(target, 'outgoing');
  if (!existsSync(target) && existsSync(outgoing)) await rename(outgoing, target);
  await rm(beside(target, 'incoming'), { recursive: true, force: true });
  await rm(outgoing, { recursive: true, force: true });
};

export class BundleRefused extends Error {}

export const replaceBundle = async (
  target: string,
  from: string,
  verify: (bundle: string) => Promise<string | null> = async () => null,
): Promise<void> => {
  await mkdir(dirname(target), { recursive: true });
  await recoverBundle(target);
  const incoming = beside(target, 'incoming');
  const outgoing = beside(target, 'outgoing');
  await cloned(from, incoming);
  const refused = await verify(incoming);
  if (refused !== null) {
    await rm(incoming, { recursive: true, force: true });
    throw new BundleRefused(refused);
  }
  const standing = existsSync(target);
  if (standing) await rename(target, outgoing);
  try {
    await rename(incoming, target);
  } catch (error) {
    if (standing && !existsSync(target)) await rename(outgoing, target);
    await rm(incoming, { recursive: true, force: true });
    throw error;
  }
  await rm(outgoing, { recursive: true, force: true });
};

export const copyBundle = (from: string, to: string): Promise<void> => replaceBundle(to, from);

export const carriedIn = (dir: string): string | null => {
  const bundles = readdirSync(dir).filter((name) => name.endsWith('.app'));
  return bundles.length === 1 ? carriedRelease(join(dir, bundles[0]!)) : null;
};

const bundlesUnder = (dir: string): string[] => {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.endsWith('.framework')) continue;
      const path = join(at, entry.name);
      if (entry.name.endsWith('.app')) found.push(path);
      walk(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
};

export const forgetBundles = (dir: string): void => {
  const bundles = bundlesUnder(dir);
  if (bundles.length === 0) return;
  const ran = spawnSync(LSREGISTER, ['-u', ...bundles], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  const refusals = [...(ran.stderr ?? '').matchAll(/: (-\d+)/gu)].map((match) => match[1]);
  //! -10814 is kLSApplicationNotFoundErr: a bundle never launched has no record to forget
  if (ran.status !== 0 && (refusals.length === 0 || refusals.some((code) => code !== '-10814'))) {
    throw new Error(
      `LaunchServices kept ${bundles.length} applications of ${dir}: ${ran.stderr?.trim() || ran.error?.message || `lsregister exited ${ran.status}`}`,
    );
  }
};

type Signed = { readonly status: number | null; readonly text: string };

const codesign = (args: readonly string[], signal: AbortSignal | undefined): Promise<Signed> =>
  new Promise((answer) => {
    const child = spawn(CODESIGN, [...args], { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let text = '';
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.on('error', (error) => answer({ status: null, text: error.message }));
    child.on('close', (code, ended) => answer({ status: code, text: ended === null ? text : `${text}codesign ended on ${ended}` }));
  });

const requirementOf = async (
  bundle: string,
  signal: AbortSignal,
): Promise<{ readonly said: string } | { readonly requirement: string }> => {
  const read = await codesign(['-d', '-r-', bundle], signal);
  const requirement = /designated => (.+)/u.exec(read.text)?.[1]?.trim();
  return read.status === 0 && requirement !== undefined ? { requirement } : { said: read.text.trim() || `codesign exited ${read.status}` };
};

export const verifiedBundle = async (bundle: string, signal?: AbortSignal): Promise<string | null> => {
  const verified = await codesign(['--verify', '--deep', '--strict', bundle], signal);
  return verified.status === 0
    ? null
    : `${bundle} carries no valid signature: ${verified.text.trim() || `codesign exited ${verified.status}`}`;
};

const unquarantined = (path: string): Promise<string | null> =>
  new Promise((answer) => {
    const child = spawn(XATTR, ['-dr', QUARANTINE, path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let text = '';
    child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.on('error', (error) => answer(error.message));
    child.on('close', (code) => answer(code === 0 ? null : text.trim() || `xattr exited ${code}`));
  });

export const signatureRefusal = async (carried: string, installRoot: string, signal: AbortSignal): Promise<string | null> => {
  const bundle = carrierOf(carried);
  if (bundle === null) return `${carried} is carried by no application`;
  const unsigned = await verifiedBundle(bundle, signal);
  if (unsigned !== null) return unsigned;
  const standing = currentVersion(installRoot);
  const running = standing === null ? undefined : keptApplication(join(installRoot, standing));
  if (running === undefined || !existsSync(running)) return null;
  const [offered, ours] = await Promise.all([requirementOf(bundle, signal), requirementOf(running, signal)]);
  if ('said' in offered) return `the signature of ${bundle} could not be read: ${offered.said}`;
  if ('said' in ours) return `the signature of ${running} could not be read: ${ours.said}`;
  return offered.requirement === ours.requirement
    ? null
    : `${bundle} is signed as ${offered.requirement}, and the application that stands here as ${ours.requirement}`;
};

export const applications: Applications = {
  carrier: carrierOf,
  carried: carriedIn,
  verify: verifiedBundle,
  copy: copyBundle,
  unquarantine: unquarantined,
  forget: forgetBundles,
  signature: signatureRefusal,
};
