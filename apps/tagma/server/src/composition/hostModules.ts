import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostSpecifiers, workspaceManifests } from '@runlith/tagma/adapter/host-modules';

export const GENERATED = 'hostModules.generated.ts';

export const generatedText = (specifiers: readonly string[]): string =>
  [
    "import type { HostModules } from '@runlith/tagma/adapter/loader';",
    '',
    'export const HOST_MODULES: HostModules = {',
    ...specifiers.map((specifier) => `  '${specifier}': () => import('${specifier}'),`),
    '};',
    '',
  ].join('\n');

if (import.meta.main) {
  const root = join(import.meta.dir, '../../../../..');
  await writeFile(join(import.meta.dir, GENERATED), generatedText(hostSpecifiers(await workspaceManifests(root))));
}
