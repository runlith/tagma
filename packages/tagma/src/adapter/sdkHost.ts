import { resolve } from 'node:path';
import { hostSpecifiers, workspaceManifests } from './hostModules';
import type { HostModules } from './loader';

const WORKSPACE = resolve(import.meta.dir, '../../../..');

export const sdkHost = async (): Promise<HostModules> =>
  Object.fromEntries(hostSpecifiers(await workspaceManifests(WORKSPACE)).map((specifier) => [specifier, () => import(specifier)]));
