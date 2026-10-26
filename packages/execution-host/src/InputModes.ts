import { Data, Effect } from 'effect';
import type { IDisposable, Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { InputProfile, MouseEncoding, XtermInputProfile } from '@runlith/executions/protocol/inputProfile';
import { ZWJ_VERSION, zwjProvider, type WidthTables } from '@runlith/executions/protocol/zwjWidths';

export class InputProfileUnavailable extends Data.TaggedError('InputProfileUnavailable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}
export class InputProfileConflict extends Data.TaggedError('InputProfileConflict')<{ readonly expected: number; readonly actual: number }> {
  override get message(): string {
    return `input profile ${this.actual} differs from the current revision ${this.expected}`;
  }
}

type TerminalWithKittyKeyboard = Terminal & { _core?: { coreService?: { kittyKeyboard?: { flags?: number } } } };
const widthTablesOf = (terminal: Terminal): WidthTables | undefined =>
  (terminal as unknown as { _core?: { unicodeService?: { _providers?: Record<string, WidthTables> } } })._core?.unicodeService
    ?._providers?.['11'];
const registerZwj = (terminal: Terminal, base: WidthTables): string => {
  if (!terminal.unicode.versions.includes(ZWJ_VERSION)) terminal.unicode.register(zwjProvider(base));
  return ZWJ_VERSION;
};
export const readKittyKeyboardFlags = (terminal: Terminal): number => {
  const flags = (terminal as TerminalWithKittyKeyboard)._core?.coreService?.kittyKeyboard?.flags;
  return typeof flags === 'number' ? flags : 0;
};

export type ModesInput = { readonly terminal: Terminal; readonly profile: string | undefined };

export const makeInputModes = Effect.fnUntraced(function* ({ terminal, profile: requested }: ModesInput) {
  let revision = 0;
  let encoding: MouseEncoding = 'default';
  let unavailable =
    requested === undefined
      ? 'input profile is missing'
      : requested !== 'xterm-256color-unicode11'
        ? `unsupported input profile: ${requested}`
        : undefined;
  const snapshot = () =>
    Effect.sync((): InputProfile => {
      if (unavailable !== undefined) return { _tag: 'Unavailable', revision, reason: unavailable };
      const modes = terminal.modes;
      if (
        !terminal.options.allowProposedApi ||
        (terminal.unicode.activeVersion !== '11' && terminal.unicode.activeVersion !== ZWJ_VERSION) ||
        terminal.options.vtExtensions?.win32InputMode ||
        modes.win32InputMode
      ) {
        return { _tag: 'Unavailable', revision, reason: 'terminal options or negotiated state no longer match the input profile' };
      }
      return {
        _tag: 'Available',
        revision,
        profile: 'xterm-256color-unicode11',
        encoding: 'utf-8',
        terminal: 'xterm-256color',
        unicodeVersion: '11',
        applicationCursor: modes.applicationCursorKeysMode,
        applicationKeypad: modes.applicationKeypadMode,
        bracketedPaste: modes.bracketedPasteMode,
        sendFocus: modes.sendFocusMode,
        mouseTracking: modes.mouseTrackingMode,
        mouseEncoding: encoding,
        alternateScreen: terminal.buffer.active.type === 'alternate',
        kittyKeyboardFlags: readKittyKeyboardFlags(terminal),
      };
    });
  const requireProfile = (offered: number) =>
    Effect.flatMap(snapshot(), (profile): Effect.Effect<XtermInputProfile, InputProfileUnavailable | InputProfileConflict> => {
      if (profile._tag === 'Unavailable') return new InputProfileUnavailable({ reason: profile.reason });
      if (offered !== profile.revision) return new InputProfileConflict({ expected: profile.revision, actual: offered });
      return Effect.succeed(profile);
    });
  const reset = () =>
    Effect.sync(() => {
      encoding = 'default';
      revision++;
    });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      unavailable = 'input profile scope is closed';
    }),
  );
  if (unavailable === undefined) {
    const register = (acquire: () => IDisposable) =>
      Effect.acquireRelease(
        Effect.try({ try: acquire, catch: (cause) => new InputProfileUnavailable({ reason: String(cause) }) }),
        (handler) => Effect.sync(() => handler.dispose()),
      );
    yield* register(() => {
      terminal.options.allowProposedApi = true;
      terminal.options.vtExtensions = { ...terminal.options.vtExtensions, kittyKeyboard: true, win32InputMode: false };
      const unicode = new Unicode11Addon();
      terminal.loadAddon(unicode);
      const base = widthTablesOf(terminal);
      terminal.unicode.activeVersion = base === undefined ? '11' : registerZwj(terminal, base);
      return unicode;
    });
    for (const final of ['h', 'l']) {
      yield* register(() =>
        terminal.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
          let changed = false;
          for (const param of params) {
            if (typeof param !== 'number') continue;
            switch (param) {
              case 1006:
                encoding = final === 'h' ? 'sgr' : 'default';
                changed = true;
                break;
              case 1016:
                encoding = final === 'h' ? 'sgr-pixels' : 'default';
                changed = true;
                break;
              case 1:
              case 66:
              case 9:
              case 1000:
              case 1002:
              case 1003:
              case 1004:
              case 2004:
              case 47:
              case 1047:
              case 1049:
                changed = true;
                break;
            }
          }
          if (changed) revision++;
          return false;
        }),
      );
    }
    for (const prefix of ['=', '>', '<']) {
      yield* register(() =>
        terminal.parser.registerCsiHandler({ prefix, final: 'u' }, () => {
          revision++;
          return false;
        }),
      );
    }
    for (const final of ['=', '>']) {
      yield* register(() =>
        terminal.parser.registerEscHandler({ final }, () => {
          revision++;
          return false;
        }),
      );
    }
    yield* register(() =>
      terminal.parser.registerEscHandler({ final: 'c' }, () => {
        encoding = 'default';
        revision++;
        return false;
      }),
    );
    yield* register(() =>
      terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
        revision++;
        return false;
      }),
    );
  }
  return { snapshot, require: requireProfile, reset };
});

export type InputModes = Effect.Success<ReturnType<typeof makeInputModes>>;
