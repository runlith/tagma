import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_FILE, RIPGREP_PART, TYPESCRIPT_COMPILER } from '../contract/wire/layout.js';

export function carriedFrom(moduleUrl: string, part: string): string | null {
  const root = fileURLToPath(new URL('../../', moduleUrl));
  return existsSync(join(root, INSTALL_FILE)) ? join(root, part) : null;
}

export function presentCarried(carried: string | null): string | null {
  return carried !== null && existsSync(carried) ? carried : null;
}

export const CARRIED_RIPGREP: string | null = carriedFrom(import.meta.url, RIPGREP_PART);

export const CARRIED_TYPESCRIPT: string | null = carriedFrom(import.meta.url, TYPESCRIPT_COMPILER);
