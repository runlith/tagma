import { Effect } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import { describe, expect, test } from 'vitest';
import { ComposerRefused, type ComposerSlashCommand, settled } from './composer';
import { ComposerContributions } from './ComposerContributions.svelte';
import { ComposerMenu } from './ComposerMenu.svelte';
import { RegistryClash } from '@runlith/roster/RegistryClash';
const command = (name: string, rest: Partial<ComposerSlashCommand> = {}): ComposerSlashCommand => ({
  name,
  run: () => Effect.void,
  ...rest,
});
describe('commands contributed to the composer', () => {
  test('a command is offered by the slash menu, follows its own data, and is gone after its disposer', () => {
    const composer = new ComposerContributions();
    const menu = new ComposerMenu(() => ({ commands: composer.commands, providers: composer.mentions }));
    const state = $state({ blocked: false });
    const dispose = composer.command('threads', {
      name: 'compact',
      get disabled() {
        return state.blocked;
      },
      run: () => Effect.void,
    });
    menu.update({ text: '/', from: 1, to: 1 });
    expect(menu.options.map((option) => [option.id, option.disabled])).toEqual([['compact', false]]);
    state.blocked = true;
    expect(menu.options.map((option) => [option.id, option.disabled])).toEqual([['compact', true]]);
    dispose();
    expect(composer.commands).toEqual([]);
    menu.update({ text: '/c', from: 2, to: 2 });
    expect(menu.kind).toBeNull();
  });
  test('a name contributed twice refuses the assembly and names both contributors', () => {
    const composer = new ComposerContributions();
    composer.command('threads', command('mode'));
    expect(() => composer.command('plugins', command('mode'))).toThrow(RegistryClash);
    expect(() => composer.command('plugins', command('mode'))).toThrow(/threads.*plugins/);
    expect(composer.commands).toHaveLength(1);
  });
  test('ordered commands come first, unordered ones last, and equal orders keep registration order', () => {
    const composer = new ComposerContributions();
    composer.command('chat', command('verbose'));
    composer.command('threads', { ...command('b'), order: 20 });
    composer.command('threads', { ...command('a'), order: 20 });
    composer.command('threads', { ...command('first'), order: 10 });
    composer.command('chat', command('stretches'));
    expect(composer.commands.map((one) => one.name)).toEqual(['first', 'b', 'a', 'verbose', 'stretches']);
  });
  it.effect('what a command returns becomes the notice shown, and a refusal becomes an error notice', () =>
    Effect.gen(function* () {
      const composer = new ComposerContributions();
      const ran: unknown[] = [];
      composer.command('threads', {
        name: 'recap',
        run: (args) => Effect.sync(() => void ran.push(args)).pipe(Effect.as({ tone: 'success' as const, message: 'Recap written.' })),
      });
      composer.command('threads', { name: 'new', run: () => Effect.fail(new ComposerRefused({ message: 'Nothing to start from.' })) });
      const [recap, fresh] = composer.commands;
      expect(yield* settled(recap!.run({ gesture: 'queue', optionId: 'x' }))).toEqual({
        tone: 'success',
        message: 'Recap written.',
      });
      expect(ran).toEqual([{ gesture: 'queue', optionId: 'x' }]);
      expect(yield* settled(fresh!.run({ gesture: 'send' }))).toEqual({ tone: 'error', message: 'Nothing to start from.' });
      expect(yield* settled(Effect.void)).toBeNull();
    }),
  );
});
describe('attachment kinds contributed to the composer', () => {
  it.effect('each file goes to the first kind that accepts it, and the accept list is the union of the kinds', () =>
    Effect.gen(function* () {
      const composer = new ComposerContributions();
      const took: Array<[string, string[]]> = [];
      const kind = (id: string, accept: string, accepts: (file: File) => boolean) =>
        composer.attachment('threads', {
          id,
          accept,
          button: true,
          accepts,
          intake: (files) => Effect.sync(() => void took.push([id, files.map((file) => file.name)])),
        });
      kind('images', 'image/*', (file) => file.type.startsWith('image/'));
      kind('documents', '.pdf', (file) => file.name.endsWith('.pdf'));
      expect(composer.attachAccept).toBe('image/*,.pdf');
      const files = [
        new File([''], 'a.png', { type: 'image/png' }),
        new File([''], 'b.pdf', { type: 'application/pdf' }),
        new File([''], 'c.txt', { type: 'text/plain' }),
      ];
      yield* settled(composer.intake(files));
      expect(took).toEqual([
        ['images', ['a.png']],
        ['documents', ['b.pdf']],
      ]);
    }),
  );
});
describe('chips contributed to the composer', () => {
  test('a region lists its chips by order and one cycling chip answers the mode key', () => {
    const composer = new ComposerContributions();
    const body = (() => undefined) as never;
    composer.chip('threads', { id: 'late', region: 'right', order: 2, body });
    composer.chip('threads', { id: 'early', region: 'right', order: -1, body });
    composer.chip('threads', { id: 'elsewhere', region: 'leading', body, cycle: { available: true, run: () => Effect.void } });
    expect(composer.chips('right').map((chip) => chip.id)).toEqual(['early', 'late']);
    expect(composer.chips('leading').map((chip) => chip.id)).toEqual(['elsewhere']);
    expect(composer.cycler?.id).toBe('elsewhere');
  });
});
describe('contract refusals of the composer registry', () => {
  test('a second chip that cycles is refused, naming both contributors', () => {
    const composer = new ComposerContributions();
    const body = (() => undefined) as never;
    composer.chip('threads', { id: 'mode', region: 'leading', body, cycle: { available: true, run: () => Effect.void } });
    expect(() =>
      composer.chip('plugins', { id: 'other', region: 'leading', body, cycle: { available: true, run: () => Effect.void } }),
    ).toThrow(/threads.*plugins/);
  });
  it.effect('an error from any claimed kind outranks the success of an earlier one', () =>
    Effect.gen(function* () {
      const composer = new ComposerContributions();
      composer.attachment('threads', {
        id: 'images',
        accept: 'image/*',
        button: true,
        accepts: (file) => file.type.startsWith('image/'),
        intake: () => Effect.succeed({ tone: 'success' as const, message: 'Attached.' }),
      });
      composer.attachment('threads', {
        id: 'documents',
        accept: '.pdf',
        button: true,
        accepts: (file) => file.name.endsWith('.pdf'),
        intake: () => Effect.fail(new ComposerRefused({ message: 'The document is too large.' })),
      });
      const files = [new File([''], 'a.png', { type: 'image/png' }), new File([''], 'b.pdf')];
      expect(yield* settled(composer.intake(files))).toEqual({ tone: 'error', message: 'The document is too large.' });
    }),
  );
});
