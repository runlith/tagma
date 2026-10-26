import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_SOURCES } from '@runlith/tagma/sources';
import { declarationsOf, signaturesOf, type RulesDoor } from './declarations.js';

export const ruleSignatures = async (): Promise<Readonly<Record<string, string>>> => {
  const doors = Object.entries(RULE_SOURCES).map(([key, url]) => ({ key, source: fileURLToPath(url) }));
  return signaturesOf(await declarationsOf(doors));
};

export const emitRules = async (out: string, doors: readonly RulesDoor[]): Promise<void> => {
  const declarations = await declarationsOf(doors);
  await mkdir(join(out, 'rules'), { recursive: true });
  for (const door of doors) await writeFile(join(out, 'rules', `${basename(door.source, '.ts')}.d.ts`), declarations[door.key]!);
  const runtime = await Bun.build({
    entrypoints: doors.map((door) => door.source),
    outdir: join(out, 'rules'),
    naming: '[name].js',
    target: 'browser',
    format: 'esm',
  });
  if (!runtime.success) throw new AggregateError(runtime.logs, 'The rules doors did not build');
};
