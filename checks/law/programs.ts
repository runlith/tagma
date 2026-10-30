import { defineProgram, type Answer, type InspectionInput, type Program, type Reading, type Side } from '@runlith/tagma/rules';
import type { ProgramSide } from '@tagma/inspection/program';
import type { InspectionMemo, MemoValue } from '@tagma/inspection/node/memo';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { ParseMemo } from '@runlith/code-facts/blobs';
import { checkOf } from './checks';
import { type HeldBlobs, sideTree } from './trees';
import { type MigrationsParams, type StepPlacesParams, storedJudge } from './migrations';
import type { EffectStyleParams } from './effect-style/declaration';
import type { EnvironmentParams } from './environment/declaration';
import type { UiTokensParams } from './ui-tokens/declaration';
import type { DeadParams, RepeatedParams } from './declarations/declaration';
import type { CouplingParams, VendorParams } from './architecture/inspections';
import type { CallParams } from './architecture/calls/params';

const root = process.cwd();
const parses: ParseMemo = new Map();
const blobs: HeldBlobs = { listings: new Map(), texts: new Map() };
const held = new Map<string, MemoValue>();
const memo: InspectionMemo = {
  get: (key) => held.get(key),
  set: (key, value) => {
    held.set(key, value);
  },
};

type Named = ProgramSide['side'];

const supplied = async (name: Named, side: Side): Promise<ProgramSide> => {
  if (side.whole) return { side: name, paths: null, files: null };
  const files = await Promise.all(
    side.paths.map(async (path) => {
      const text = await side.read(path);
      if (text === null) throw new Error(`the ${name} side holds no text at ${path}`);
      return { path, text };
    }),
  );
  return { side: name, paths: side.paths, files };
};

const checked =
  (id: string) =>
  async (input: InspectionInput<object>): Promise<Answer> => {
    await (engine ??= prepared());
    const check = await checkOf(id, input.params);
    const reading = async (name: Named, side: Side): Promise<Reading> => {
      const reach = new Set(side.paths);
      const tree = sideTree(
        root,
        side.commit,
        await supplied(name, side),
        [''],
        (path) => reach.has(path) && check.selects(path),
        parses,
        blobs,
      );
      const paths = side.whole ? [...tree.paths!()] : side.paths.filter((path) => tree.has(path));
      const read = check.read(tree, paths, ADAPTERS, memo, side.whole ? 'reach' : 'change');
      if (read.unjudged.length > 0) throw new Error(`${id} left ${read.unjudged.length} sources of the ${name} side unjudged`);
      return {
        covered: 'paths',
        findings: read.violations.map((one) => ({
          fingerprint: one.fingerprint,
          path: one.file,
          line: one.line,
          message: one.message ?? '',
          fix: one.fix,
          value: one.value,
          sites: one.sites,
        })),
      };
    };
    const tree = await reading('tree', input.tree);
    return input.base === null ? { tree } : { tree, base: await reading('base', input.base) };
  };

let engine: Promise<void> | undefined;

const prepared = async (): Promise<void> => {
  const { prepareEngine, selectEngine } = await import('@runlith/sqlite-process/engine');
  await prepareEngine();
  selectEngine();
};

const stored =
  (id: 'migrations' | 'step-places') =>
  async (input: InspectionInput<object>): Promise<Answer> => {
    await (engine ??= prepared());
    const judge = storedJudge(root, input.tree.commit, input.base?.commit ?? null);
    const readings = await judge.judge({ key: id, id, params: input.params });
    judge.save();
    const side = (name: Named): Reading => ({
      covered: 'reach',
      findings: readings.find((one) => one.side === name)?.findings ?? [],
    });
    return input.base === null ? { tree: side('tree') } : { tree: side('tree'), base: side('base') };
  };

const lazily =
  <Params extends object>(load: () => Promise<{ readonly default: { readonly [key: string]: Program<never> } }>, key: string) =>
  async (input: InspectionInput<Params>): Promise<Answer> => {
    await (engine ??= prepared());
    const handler = (await load()).default[key] as Program<Params> | undefined;
    if (handler === undefined) throw new Error(`the law programs hold no handler for ${key}`);
    return handler(input);
  };

export default defineProgram<{
  'effect-style': EffectStyleParams;
  'ui-tokens': UiTokensParams;
  environment: EnvironmentParams;
  migrations: MigrationsParams;
  'step-places': StepPlacesParams;
  'repeated-declarations': RepeatedParams;
  'dead-code': DeadParams;
  'vendor-ids': VendorParams;
  coupling: CouplingParams;
  'ask-calls': CallParams;
}>({
  'effect-style': checked('effect-style'),
  'ui-tokens': checked('ui-tokens'),
  environment: checked('environment'),
  migrations: stored('migrations'),
  'step-places': stored('step-places'),
  'repeated-declarations': lazily<RepeatedParams>(() => import('./declarations/program'), 'repeated-declarations'),
  'dead-code': lazily<DeadParams>(() => import('./declarations/program'), 'dead-code'),
  'vendor-ids': lazily<VendorParams>(() => import('./architecture/programs'), 'vendor-ids'),
  coupling: lazily<CouplingParams>(() => import('./architecture/programs'), 'coupling'),
  'ask-calls': lazily<CallParams>(() => import('./architecture/calls/program'), 'ask-calls'),
});
