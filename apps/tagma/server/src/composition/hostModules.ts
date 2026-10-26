import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type HostMarks, marksOf, workspaceManifests } from '@runlith/tagma/adapter/host-modules';

export const GENERATED = 'hostModules.generated.ts';

const record = (name: string, specifiers: readonly string[]): string =>
  [
    `export const ${name}: Readonly<Record<string, HostModule>> = {`,
    ...specifiers.map((specifier) => `  '${specifier}': () => import('${specifier}'),`),
    '};',
  ].join('\n');

export const generatedText = (marks: HostMarks): string =>
  [
    "import type { HostModule } from '@runlith/tagma/adapter/loader';",
    '',
    record('SHARED_HOST_MODULES', marks.shared),
    '',
    record('DEVELOPER_HOST_MODULES', marks.developer),
    '',
  ].join('\n');

if (import.meta.main) {
  const root = join(import.meta.dir, '../../../../..');
  await writeFile(join(import.meta.dir, GENERATED), generatedText(marksOf(await workspaceManifests(root))));
}
