// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Effect, FiberSet } from 'effect';
import { it } from '@runlith/effect-test/vitest';
import Composer from './Composer.svelte';
import { type ComposerGesture, type ComposerHandler, type ComposerSlashCommand, settled } from './composer';
import { ComposerContributions } from './ComposerContributions.svelte';
import { PromptHandle } from './PromptHandle.svelte';
import { PromptHistory, type PromptHistoryEntry, type PromptHistoryStore } from './PromptHistory';
import type { ChatButton, ChatRendering } from './renderers';
import type { ChatRewind, ChatRewindTarget } from './rewind';
import type { ChatStrings } from './strings';
const CHAT_RENDERING = Symbol.for('runlith.chat-ui.rendering');
const CHAT_STRINGS = Symbol.for('runlith.chat-ui.strings');
const strings = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'locale') return 'en';
      return (...args: unknown[]) => (args.length === 0 ? String(key) : `${String(key)} ${args.join(' ')}`);
    },
  },
) as ChatStrings;
const rendering = {
  button: createRawSnippet((control: () => ChatButton) => ({
    render: () =>
      `<span><button type="button"></button>${(control().choices ?? []).map((_, at) => `<button type="button" data-choice="${at}"></button>`).join('')}</span>`,
    setup(element) {
      for (const choice of element.querySelectorAll<HTMLElement>('[data-choice]')) {
        choice.addEventListener('click', () => control().choices?.[Number(choice.dataset.choice)]?.onSelect());
      }
    },
  })),
  key: createRawSnippet(() => ({ render: () => '<kbd></kbd>' })),
} as unknown as ChatRendering;
let host: HTMLElement | undefined;
let app: Record<string, unknown> | undefined;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  nativeEditing();
});
afterEach(async () => {
  if (app) await unmount(app);
  vi.unstubAllGlobals();
  host?.remove();
  app = undefined;
  host = undefined;
});
function nativeEditing(): void {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value(command: string, _ui?: boolean, text?: string): boolean {
      const field = document.activeElement;
      if (!(field instanceof HTMLTextAreaElement)) return false;
      if (command !== 'insertText' && command !== 'delete') return false;
      const written = command === 'insertText' ? (text ?? '') : '';
      const from = field.selectionStart;
      field.value = `${field.value.slice(0, from)}${written}${field.value.slice(field.selectionEnd)}`;
      field.setSelectionRange(from + written.length, from + written.length);
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    },
  });
}
type CommandSpec = Omit<ComposerSlashCommand, 'run'>;
const open = Effect.fnUntraced(function* (commands: readonly CommandSpec[], history?: PromptHistory, running = false) {
  const perform = yield* FiberSet.makeRuntimePromise<never>();
  host = document.createElement('div');
  document.body.append(host);
  const drafts: string[] = [];
  const executed: Array<[string, string | undefined]> = [];
  const gestures: Array<ComposerGesture | undefined> = [];
  const opened: string[] = [];
  const submitted: Array<'send' | 'queue'> = [];
  let textarea: HTMLTextAreaElement | null = null;
  const contributions = new ComposerContributions();
  for (const spec of commands) {
    contributions.command('test', {
      ...spec,
      run: (args) =>
        Effect.sync(() => {
          if (spec.opens) opened.push(args.query ?? '');
          else {
            executed.push([spec.name, args.optionId]);
            gestures.push(args.gesture);
          }
        }),
    });
  }
  const props = $state({
    contributions,
    handle: new PromptHandle(),
    canSend: true,
    draft: '',
    placeholder: 'prompt',
    running,
    history,
    onDraft(value: string) {
      drafts.push(value);
      props.draft = value;
      if (textarea) textarea.value = value;
    },
    onSend() {
      submitted.push('send');
    },
    onQueue() {
      submitted.push('queue');
    },
    perform(handler: ComposerHandler) {
      void perform(settled(handler));
    },
  });
  app = mount(Composer, {
    target: host,
    props,
    context: new Map<symbol, unknown>([
      [CHAT_RENDERING, rendering],
      [CHAT_STRINGS, strings],
    ]),
  }) as Record<string, unknown>;
  flushSync();
  textarea = host.querySelector('textarea');
  if (!textarea) return yield* Effect.die('Composer textarea did not mount.');
  textarea.focus();
  return { textarea, drafts, executed, gestures, opened, submitted, host };
});
function type(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.selectionStart = value.length;
  textarea.selectionEnd = value.length;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  flushSync();
}
function press(textarea: HTMLTextAreaElement, key: string): void {
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
  textarea.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  flushSync();
}
function caretTo(textarea: HTMLTextAreaElement, offset: number): void {
  textarea.setSelectionRange(offset, offset);
  textarea.dispatchEvent(new Event('select', { bubbles: true }));
  flushSync();
}
function sent(...texts: readonly string[]): PromptHistory {
  let entries: readonly PromptHistoryEntry[] = texts.map((text, index) => ({ text, at: 1000 - index }));
  const record: PromptHistoryStore = {
    read: () => entries,
    write: (written) => {
      entries = written;
    },
  };
  return new PromptHistory(record);
}
describe('sending while a turn runs', () => {
  it.effect('the send control offers the next step and after this turn, so a pointer can queue words without a key', () =>
    Effect.gen(function* () {
      const { textarea, submitted, host } = yield* open([], undefined, true);
      type(textarea, 'use orders_v2');
      const choices = host.querySelectorAll<HTMLButtonElement>('[data-choice]');
      expect(choices).toHaveLength(2);
      choices[1]!.click();
      choices[0]!.click();
      expect(submitted).toEqual(['queue', 'send']);
    }),
  );
});

describe('executing a slash command consumes its draft token', () => {
  it.effect('Enter executes a matching plain command with an empty draft and a closed menu', () =>
    Effect.gen(function* () {
      const { textarea, drafts, executed } = yield* open([{ name: 'compact' }]);
      type(textarea, '/compact');
      expect(drafts).toEqual(['/compact']);
      expect(textarea.selectionStart).toBe('/compact'.length);
      expect(host?.querySelector('[data-popup-option]')).not.toBeNull();
      press(textarea, 'Enter');
      expect(executed).toEqual([['compact', undefined]]);
      expect(drafts.at(-1)).toBe('');
      expect(textarea.value).toBe('');
      expect(host?.querySelector('[data-popup-option]')).toBeNull();
    }),
  );
  it.effect('Enter picks an option with an empty draft and a closed menu', () =>
    Effect.gen(function* () {
      const { textarea, drafts, executed } = yield* open([
        {
          name: 'model',
          options: [
            { id: 'opus', label: 'Opus' },
            { id: 'sol', label: 'Sol' },
          ],
        },
      ]);
      type(textarea, '/model');
      expect(host?.querySelector('[data-popup-option]')).not.toBeNull();
      press(textarea, 'Enter');
      expect(executed).toEqual([['model', 'opus']]);
      expect(drafts.at(-1)).toBe('');
      expect(textarea.value).toBe('');
      expect(host?.querySelector('[data-popup-option]')).toBeNull();
    }),
  );
  it.effect('a command that opens a panel hands it what follows its name, typed whole or picked, and leaves the draft empty', () =>
    Effect.gen(function* () {
      const { textarea, drafts, executed, opened } = yield* open([{ name: 'model', opens: true }, { name: 'mode' }]);
      type(textarea, '/model');
      expect(opened).toEqual(['']);
      expect(drafts.at(-1)).toBe('');
      expect(textarea.value).toBe('');
      type(textarea, '/model gpt');
      expect(opened).toEqual(['', 'gpt']);
      expect(textarea.value).toBe('');
      type(textarea, '/mdl');
      press(textarea, 'Enter');
      expect(opened).toEqual(['', 'gpt', '']);
      expect(executed).toEqual([]);
      expect(textarea.value).toBe('');
    }),
  );
  it.effect('while a turn goes, a command reaches the product with the gesture that picked it: Enter a send, Tab a queue', () =>
    Effect.gen(function* () {
      const { textarea, executed, gestures } = yield* open([{ name: 'compact' }], undefined, true);
      type(textarea, '/compact');
      press(textarea, 'Enter');
      type(textarea, '/compact');
      press(textarea, 'Tab');
      expect(executed).toEqual([
        ['compact', undefined],
        ['compact', undefined],
      ]);
      expect(gestures).toEqual(['send', 'queue']);
      expect(textarea.value).toBe('');
    }),
  );
});
describe('recalling what this reader already sent', () => {
  it.effect('Up writes the entry into the field with the caret at its start, and the next press keeps walking', () =>
    Effect.gen(function* () {
      const { textarea, drafts } = yield* open([], sent('C', 'B', 'A'));
      press(textarea, 'ArrowUp');
      expect(textarea.value).toBe('C');
      expect(textarea.selectionStart).toBe(0);
      expect(drafts.at(-1)).toBe('C');
      press(textarea, 'ArrowUp');
      expect(textarea.value).toBe('B');
      expect(textarea.selectionStart).toBe(0);
    }),
  );
  it.effect('a caret away from the start leaves Up to the browser, and Escape gives the draft back', () =>
    Effect.gen(function* () {
      const { textarea } = yield* open([], sent('C', 'B', 'A'));
      type(textarea, 'half a thought');
      press(textarea, 'ArrowUp');
      expect(textarea.value).toBe('half a thought');
      caretTo(textarea, 0);
      press(textarea, 'ArrowUp');
      expect(textarea.value).toBe('C');
      press(textarea, 'Escape');
      expect(textarea.value).toBe('half a thought');
      expect(textarea.selectionStart).toBe('half a thought'.length);
    }),
  );
  it.effect('Down past the newest is the draft again, empty as the reader left it', () =>
    Effect.gen(function* () {
      const { textarea } = yield* open([], sent('C'));
      press(textarea, 'ArrowUp');
      expect(textarea.value).toBe('C');
      caretTo(textarea, 'C'.length);
      press(textarea, 'ArrowDown');
      expect(textarea.value).toBe('');
    }),
  );
  it.effect('typing over a recalled prompt ends the walk, so Down is the browser’s again', () =>
    Effect.gen(function* () {
      const { textarea } = yield* open([], sent('C', 'B'));
      press(textarea, 'ArrowUp');
      type(textarea, 'Cx');
      press(textarea, 'ArrowDown');
      expect(textarea.value).toBe('Cx');
    }),
  );
});
describe('rewinding from the keyboard', () => {
  const target = (runId: string, ordinal: number): ChatRewindTarget => ({
    runId,
    entryId: `u-${runId}`,
    text: `words of ${runId}`,
    ordinal,
    failed: false,
    steps: 0,
    answered: true,
  });
  function openRewinding(held: readonly string[] = []) {
    host = document.createElement('div');
    document.body.append(host);
    const acts: string[] = [];
    const rewind = {
      words: strings as unknown as ChatRewind['words'],
      busy: false,
      point: (runId: string) => (held.includes(runId) ? { rewindable: false, why: 'summarized' } : { rewindable: true }),
      restorable: () => false,
      rewind: async (runId: string, scope: string) => {
        acts.push(`${scope} ${runId}`);
        return true;
      },
      branch: (runId: string) => acts.push(`branch ${runId}`),
      restore: (rewindId: string) => acts.push(`restore ${rewindId}`),
    } satisfies ChatRewind;
    app = mount(Composer, {
      target: host,
      props: {
        contributions: new ComposerContributions(),
        handle: new PromptHandle(),
        canSend: false,
        draft: '',
        placeholder: 'prompt',
        rewindTargets: [target('run-1', 1), target('run-2', 2), target('run-3', 3)],
        onDraft() {},
        onSend() {},
        perform() {},
      },
      context: new Map<symbol, unknown>([
        [CHAT_RENDERING, { ...rendering, rewind }],
        [CHAT_STRINGS, strings],
      ]),
    }) as Record<string, unknown>;
    flushSync();
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea did not mount.');
    textarea.focus();
    return { textarea, acts };
  }
  function escape(): void {
    (app as { escapeToRewind(): boolean }).escapeToRewind();
    flushSync();
  }
  test('Escape twice opens the picker on the newest message; Up and Enter rewind from the one before it', () => {
    const { textarea, acts } = openRewinding();
    escape();
    expect(host?.querySelector('[data-pick]')).toBeNull();
    escape();
    expect(host?.querySelector('[data-pick][aria-selected="true"]')?.getAttribute('data-pick')).toBe('2');
    press(textarea, 'ArrowUp');
    press(textarea, 'Enter');
    expect(acts).toEqual(['from run-2']);
    expect(host?.querySelector('[data-pick]')).toBeNull();
  });
  test('B branches from the picked message, and the walk skips a message no rewind can reach', () => {
    const { textarea, acts } = openRewinding(['run-2']);
    escape();
    escape();
    press(textarea, 'ArrowUp');
    press(textarea, 'b');
    expect(acts).toEqual(['branch run-1']);
  });
  test('Up in the empty field edits the newest message', () => {
    const { textarea, acts } = openRewinding();
    press(textarea, 'ArrowUp');
    expect(acts).toEqual(['from run-3']);
  });
});
