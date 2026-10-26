import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Road } from './dispatch.js';

export const baseFile = (temporary: string, session: string, filePath: string): string =>
  join(temporary, `tagma-base-${session}`, new Bun.CryptoHasher('sha256').update(filePath).digest('hex').slice(0, 32));

export const CREATION_MARKER = '.absent';

const standingPath = (road: Road, filePath: string): string => resolve(road.at.cwd, filePath);

export function keepBase(road: Road, session: string, filePath: string): void {
  const at = baseFile(road.temporary, session, filePath);
  const standing = standingPath(road, filePath);
  try {
    rmSync(at, { force: true });
    rmSync(`${at}${CREATION_MARKER}`, { force: true });
    mkdirSync(join(road.temporary, `tagma-base-${session}`), { recursive: true });
    if (existsSync(standing)) writeFileSync(at, readFileSync(standing));
    else writeFileSync(`${at}${CREATION_MARKER}`, '');
  } catch {}
}

function readBase(temporary: string, session: string, filePath: string): { readonly before: string | null } | undefined {
  const at = baseFile(temporary, session, filePath);
  try {
    if (existsSync(at)) return { before: readFileSync(at, 'utf8') };
    if (existsSync(`${at}${CREATION_MARKER}`)) return { before: null };
  } catch {}
  return undefined;
}

export function dropBase(temporary: string, session: string, filePath: string): void {
  const at = baseFile(temporary, session, filePath);
  try {
    rmSync(at, { force: true });
    rmSync(`${at}${CREATION_MARKER}`, { force: true });
  } catch {}
}

export function writtenTexts(
  road: Road,
  session: string,
  basePath: string,
  filePath: string,
): { readonly before: string | null; readonly after: string | null } | undefined {
  const base = readBase(road.temporary, session, basePath);
  if (base === undefined) return undefined;
  const standing = standingPath(road, filePath);
  try {
    if (!existsSync(standing)) return base.before === null ? undefined : { before: base.before, after: null };
    return { before: base.before, after: readFileSync(standing, 'utf8') };
  } catch {
    return undefined;
  }
}
