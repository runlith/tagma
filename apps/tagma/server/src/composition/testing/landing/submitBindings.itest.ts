import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { nativeLanding } from './native.js';

const consumer = 'import type { Existing as Imported } from "./peer.js";\n\nexport const marker = 0;\nexport type Shape = Imported;\n';
const peerBase = 'export type Existing = { readonly old: true };\n';
const scopeBase = 'export const marker = 0;\n';
const spacesBase = 'export const Peer = 1;\n\nexport const marker = 0;\n';
const localBase = 'export function read() {\n  const base = 1;\n  const middle = 2;\n  return base + middle;\n}\n';
const component = '<script module lang="ts">\nexport const marker = 0;\n</script>\n';
const shorthand = 'export const marker = 0;\n';
const barrel = 'export const marker = 0;\n';
const namespace = 'import * as API from "./barrel.js";\n\nexport const marker = 0;\n';
const contract =
  'import { Context } from "effect";\nexport class CheckoutRows extends Context.Service<CheckoutRows, {\n  headMoved(root: string): void;\n}>()("CheckoutRows") {}\n';
const service =
  'import { Effect } from "effect";\nimport { CheckoutRows } from "./checkouts.js";\nexport const read = Effect.fnUntraced(function* () {\n  const checkouts = yield* CheckoutRows;\n  return { topology: checkouts.headMoved };\n});\n';
const independent = 'export const read = (checkouts: any) => checkouts.headMoved;\n';
const serving = 'export const note = "base";\n\nexport type ServedGraph = {\n  readonly context: string;\n};\n';
const moved = 'export type Peer = { readonly old: true };\n\nexport const boundary = 1;\n';
const treeMenu = '<script lang="ts">\nconst aim = { paths: [] };\n</script>\n';
const explorer =
  '<script lang="ts">\nimport TreeMenu from "./TreeMenu.svelte";\nimport type { Existing as Shape } from "./peer.js";\nconst identity = (one: number): Shape | number => one;\n</script>\n<TreeMenu />\n';

class Landing extends Context.Service<Landing, Effect.Success<ReturnType<typeof nativeLanding>>>()('testing/BindingsLanding') {}

const landing = Layer.effect(
  Landing,
  nativeLanding({
    'consumer.ts': consumer,
    'peer.ts': peerBase,
    'scope.ts': scopeBase,
    'spaces.ts': spacesBase,
    'local.ts': localBase,
    'Component.svelte': component,
    'shorthand.ts': shorthand,
    'barrel.ts': barrel,
    'namespace.ts': namespace,
    'leaf.ts': 'export type Foreign = string;\n',
    'checkouts.ts': contract,
    'own.ts': service,
    'shared.ts': service,
    'renamed.ts': service,
    'independent.ts': independent,
    'clean.ts': 'export interface CheckoutRows {}\n',
    'serving.ts': serving,
    'moved.ts': moved,
    'TreeMenu.svelte': treeMenu,
    'ExplorerView.svelte': explorer,
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer));

layer(landing, { excludeTestServices: true, testTimeout: 60_000, timeout: '60 seconds' })('native submit_work bindings', (it) => {
  it.effect(
    'native submit_work lands shadows, data and unrelated member names, names every peer declaration the rest needs, then carries them with taking',
    () =>
      Effect.gen(function* () {
        const { born, doors, write, read } = yield* Landing;
        const peer = yield* born();
        const caller = yield* born();
        const foreign = `${peerBase}export { type Existing as Foreign };\n`;
        yield* write(peer.threadId, 'peer.ts', foreign);
        const peerConsumer = `${consumer}export const peerMarker = 1;\n`;
        yield* write(peer.threadId, 'consumer.ts', peerConsumer);
        const scope = `export type Peer = { readonly peer: true };\n${scopeBase}`;
        yield* write(peer.threadId, 'scope.ts', scope);
        const spaces = `export type Peer = { readonly peer: true };\n${spacesBase}`;
        yield* write(peer.threadId, 'spaces.ts', spaces);
        const declaredLocal = localBase.replace('  const base = 1;', '  const base = 1;\n  const local = 3;');
        yield* write(peer.threadId, 'local.ts', declaredLocal);
        const definedShorthand = `const Peer = 1;\n${shorthand}`;
        yield* write(peer.threadId, 'shorthand.ts', definedShorthand);
        const definedComponent = component.replace('export const marker', 'export type Peer = string;\nexport const marker');
        yield* write(peer.threadId, 'Component.svelte', definedComponent);
        yield* write(peer.threadId, 'barrel.ts', `${barrel}export * as NS from "./leaf.js";\n`);
        yield* write(peer.threadId, 'namespace.ts', `${namespace}export const peerMarker = true;\n`);
        yield* write(
          peer.threadId,
          'checkouts.ts',
          contract.replace(
            '  headMoved',
            '  ownMoved(root: string): void;\n  sharedMoved(root: string): void;\n  renamedMoved(root: string): void;\n  independentMoved(root: string): void;\n  headMoved',
          ),
        );
        yield* write(peer.threadId, 'shared.ts', `${service}export const peerMarker = true;\n`);
        const declared = `export type CopyWriting = { readonly readOnly: boolean };\n\n${serving}`;
        yield* write(peer.threadId, 'serving.ts', declared);
        const replaced = `${moved}export type Peer = { readonly current: true };\n`;
        yield* write(peer.threadId, 'moved.ts', replaced);
        yield* write(
          peer.threadId,
          'TreeMenu.svelte',
          treeMenu.replace(
            '</script>',
            'const one = $derived(aim.paths.length === 1);\nexport function fresh() { return one; }\n</script>',
          ),
        );

        const shadow = `${scope}export const identity = (Peer: number) => Peer;\n`;
        yield* write(caller.threadId, 'scope.ts', shadow);
        const cleanImport = `import type { CheckoutRows } from "./clean.js";\n${independent.replace('headMoved', 'independentMoved')}`;
        yield* write(caller.threadId, 'independent.ts', cleanImport);
        const mentioned = declared.replace('"base"', '"CopyWriting"');
        yield* write(caller.threadId, 'serving.ts', mentioned);
        const explorerImport = explorer.replace('Existing as Shape } from "./peer.js"', 'Foreign as Shape } from "./leaf.js"');
        yield* write(caller.threadId, 'ExplorerView.svelte', explorerImport);
        expect(
          yield* doors.atNative(
            'submit_work',
            {
              subject: 'use local names beside peer declarations and component internals',
            },
            caller,
          ),
        ).toMatchObject({
          class: 'answer',
          value: {
            submitted: { status: 'landed', carried: [], committed: ['ExplorerView.svelte', 'independent.ts', 'scope.ts', 'serving.ts'] },
          },
        });
        expect(yield* read('ExplorerView.svelte')).toBe(explorerImport);
        expect(yield* read('TreeMenu.svelte')).toBe(treeMenu);
        expect(yield* read('scope.ts')).toBe(`${scopeBase}export const identity = (Peer: number) => Peer;\n`);
        expect(yield* read('serving.ts')).toBe(serving.replace('"base"', '"CopyWriting"'));

        const imported = peerConsumer.replace('Existing as Imported', 'Foreign as Imported');
        yield* write(caller.threadId, 'consumer.ts', imported);
        const typed = `${spaces}export type Use = Peer;\n`;
        yield* write(caller.threadId, 'spaces.ts', typed);
        const usedLocal = declaredLocal.replace('return base + middle;', 'return local + middle;');
        yield* write(caller.threadId, 'local.ts', usedLocal);
        yield* write(caller.threadId, 'shorthand.ts', `${definedShorthand}export const wrapped = { Peer };\n`);
        yield* write(caller.threadId, 'Component.svelte', definedComponent.replace('</script>', 'export type Use = Peer;\n</script>'));
        yield* write(caller.threadId, 'namespace.ts', `${namespace}export type Use = API.NS.Foreign;\nexport const peerMarker = true;\n`);
        const own = service.replace('checkouts.headMoved', 'checkouts.ownMoved');
        yield* write(caller.threadId, 'own.ts', own);
        yield* write(
          caller.threadId,
          'shared.ts',
          `${service.replace('checkouts.headMoved', 'checkouts.sharedMoved')}export const peerMarker = true;\n`,
        );
        yield* write(
          caller.threadId,
          'renamed.ts',
          service.replace(
            '  return { topology: checkouts.headMoved };',
            '  const other = checkouts;\n  const { renamedMoved: topology } = other;\n  return { topology };',
          ),
        );
        yield* write(caller.threadId, 'independent.ts', cleanImport.replace('./clean.js', './checkouts.js'));
        const used = mentioned.replace('ServedGraph = {', 'ServedGraph = CopyWriting & {');
        yield* write(caller.threadId, 'serving.ts', used);
        const relocated = replaced
          .replace('export type Peer = { readonly old: true };\n', '')
          .replace('boundary = 1;', 'boundary = 1;\nexport type Use = Peer;');
        yield* write(caller.threadId, 'moved.ts', relocated);
        const explorerUse = explorerImport
          .replace('</script>', 'let menu = $state<{ fresh(): boolean }>();\nconst call = () => menu?.fresh();\n</script>')
          .replace('<TreeMenu />', '<TreeMenu bind:this={menu} />');
        yield* write(caller.threadId, 'ExplorerView.svelte', explorerUse);
        const refused = yield* doors.atNative('submit_work', { subject: 'use uncommitted peer declarations' }, caller);
        expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
        if (refused.class !== 'refusal') return;
        for (const [name, path] of [
          ['Foreign', 'peer.ts'],
          ['Peer', 'spaces.ts'],
          ['local', 'local.ts'],
          ['Peer', 'shorthand.ts'],
          ['Peer', 'Component.svelte'],
          ['NS.Foreign', 'barrel.ts'],
          ['ownMoved', 'checkouts.ts'],
          ['sharedMoved', 'checkouts.ts'],
          ['renamedMoved', 'checkouts.ts'],
          ['independentMoved', 'checkouts.ts'],
          ['CopyWriting', 'serving.ts'],
          ['Peer', 'moved.ts'],
          ['fresh', 'TreeMenu.svelte'],
        ] as const)
          expect(refused.reason).toMatch(
            new RegExp(`${RegExp.escape(name)} in ${RegExp.escape(path)}:\\d+, held by ${RegExp.escape(peer.threadId)}`),
          );
        expect(yield* read('consumer.ts')).toBe(consumer);

        expect(
          yield* doors.atNative('submit_work', { subject: 'carry the required declarations', taking: [peer.threadId] }, caller),
        ).toMatchObject({
          class: 'answer',
          value: { submitted: { status: 'landed' } },
        });
        expect(yield* read('peer.ts')).toBe(foreign);
        expect(yield* read('consumer.ts')).toBe(imported);
        expect(yield* read('scope.ts')).toBe(shadow);
        expect(yield* read('spaces.ts')).toBe(typed);
        expect(yield* read('local.ts')).toBe(usedLocal);
        expect(yield* read('own.ts')).toBe(own);
        expect(yield* read('serving.ts')).toBe(used);
        expect(yield* read('moved.ts')).toBe(relocated);
        expect(yield* read('ExplorerView.svelte')).toBe(explorerUse);
      }),
  );
});
