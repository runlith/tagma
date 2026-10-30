import { HARNESS_STORAGE_BASE } from '../../threads/contract/wire/harness/session.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';

export const storageVariables = (row: HarnessAdapter | null): readonly string[] => {
  const file = row?.mcp?.file;
  const homes = [row?.hooks?.user?.homeEnv, file?._tag === 'Home' ? file.homeEnv : undefined];
  return [...new Set([...HARNESS_STORAGE_BASE, ...homes.filter((name) => name !== undefined)])];
};
