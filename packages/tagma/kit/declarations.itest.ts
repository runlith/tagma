import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_SOURCES } from '@runlith/tagma/sources';
import { declarationsOf } from './declarations.js';
import { ruleSignatures } from './rules.js';

test('the published rules declarations expand every private type, wherever the doors use it', async () => {
  const doors = Object.entries(RULE_SOURCES).map(([key, url]) => ({ key, source: fileURLToPath(url) }));
  const declarations = await declarationsOf(doors);
  for (const text of Object.values(declarations)) expect(text).not.toContain('@tagma/');
  expect(declarations['@runlith/tagma/rules']).toContain("readonly mode?: ('change' | 'measure');");
  expect((await ruleSignatures()).defineProgram).toContain("readonly mode?: ('change' | 'measure');");
});

test('only a reference to the private binding expands: its own name elsewhere, or a parameter shadowing it, stays as written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tagma-declarations-'));
  try {
    const source = join(root, 'door.ts');
    await writeFile(
      source,
      [
        "import type { ProgramMode } from '@tagma/inspection/program';",
        'export type Limited<T extends ProgramMode = ProgramMode> = { readonly mode: T };',
        'export type Box<ProgramMode> = { readonly value: ProgramMode };',
        'export type Named = { readonly ProgramMode: string };',
        'export const label = (ProgramMode: string): string => ProgramMode;',
      ].join('\n'),
    );
    const declaration = (await declarationsOf([{ key: 'door', source }])).door!;
    expect(declaration).toContain("Limited<T extends ('change' | 'measure') = ('change' | 'measure')>");
    expect(declaration).toContain('readonly value: ProgramMode;');
    expect(declaration).toContain('readonly ProgramMode: string;');
    expect(declaration).toContain('label: (ProgramMode: string) => string;');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
