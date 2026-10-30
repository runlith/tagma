import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { LAW_END, LAW_START } from '../../graph/contract/wire/law.js';
import { InstallFailed, installFailure } from '../../installation/contract/wire/install.js';
import { HarnessAdapters } from '../contract/service/adapters.js';

export type LawWrite = 'created' | 'replaced' | 'appended';
export type InstructionWrite = LawWrite | 'skipped-import' | 'absent';

export type LawPlan = { readonly path: string; readonly write: LawWrite; readonly text: string };
type InstructionPlan = LawPlan | { readonly path: string; readonly write: 'skipped-import' | 'absent'; readonly text: null };

export const planLawSection = Effect.fn('harnessInstall.planLawSection')(function* (filePath: string, section: string) {
  const current = yield* Effect.try({
    try: () => (existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''),
    catch: installFailure,
  });
  const start = current.indexOf(LAW_START);
  const end = current.indexOf(LAW_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    return yield* new InstallFailed({ detail: `${filePath} has a broken tagma:law section` });
  }
  if (start !== -1 && end !== -1) {
    return { path: filePath, write: 'replaced', text: current.slice(0, start) + section + current.slice(end + LAW_END.length) } as const;
  }
  if (current.length > 0) return { path: filePath, write: 'appended', text: `${current.trimEnd()}\n\n${section}\n` } as const;
  return { path: filePath, write: 'created', text: `${section}\n` } as const;
});

export const applyLaw = (plan: LawPlan): Effect.Effect<LawWrite, InstallFailed> =>
  Effect.try({
    try: () => {
      mkdirSync(dirname(plan.path), { recursive: true });
      writeFileSync(plan.path, plan.text);
      return plan.write;
    },
    catch: installFailure,
  }).pipe(Effect.withSpan('harnessInstall.applyLaw'));

export const writeLawSection = (filePath: string, section: string): Effect.Effect<LawWrite, InstallFailed> =>
  Effect.flatMap(planLawSection(filePath, section), applyLaw);

export const planInstructions = Effect.fn('harnessInstall.planInstructions')(function* (root: string, section: string) {
  const adapters = yield* HarnessAdapters;
  const declared = new Map(
    adapters.all().flatMap(({ instructions }) => (instructions === undefined ? [] : [[instructions.file, instructions] as const])),
  );
  return yield* Effect.forEach(declared.values(), (surface): Effect.Effect<InstructionPlan, InstallFailed> =>
    Effect.gen(function* () {
      const path = join(root, surface.file);
      if (!existsSync(path)) return { path, write: 'absent', text: null };
      const text = yield* Effect.try({ try: () => readFileSync(path, 'utf8'), catch: installFailure });
      if (surface.imports?.(text) === true) return { path, write: 'skipped-import', text: null };
      return yield* planLawSection(path, section);
    }),
  );
});

export const applyInstructions = (plan: InstructionPlan): Effect.Effect<InstructionWrite, InstallFailed> =>
  plan.text === null ? Effect.succeed(plan.write) : applyLaw(plan);
