import { Data, Effect } from 'effect';
import type { IDisposable, ITheme, Terminal } from '@xterm/headless';
import type { CursorAppearance, ScreenAppearance, TerminalColors } from '@runlith/executions/protocol/appearance';

export class AppearanceUnavailable extends Data.TaggedError('AppearanceUnavailable')<{ readonly cause: unknown }> {
  override get message(): string {
    return String(this.cause);
  }
}

type Reply = (bytes: Uint8Array) => void;
const ansiNames = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;
const defaults = ['foreground', 'background', 'cursor'] as const;
const cursorShapes = ['block', 'underline', 'bar'] as const;

export type AppearanceInput = {
  readonly terminal: Terminal;
  readonly base: TerminalColors;
  readonly reply: Reply;
};

export const makeAppearance = Effect.fnUntraced(function* ({ terminal, base: supplied, reply }: AppearanceInput) {
  const base = { ...supplied, palette: [...supplied.palette] };
  let colors: TerminalColors = base;
  let title = '';
  let style: CursorAppearance['style'] | undefined;
  let blink: boolean | undefined;
  let failure: AppearanceUnavailable | undefined;

  const resetCursor = (): void => {
    style = undefined;
    blink = undefined;
  };
  const cursorStyle = (param: number): void => {
    if (param === 0) {
      resetCursor();
      return;
    }
    if (param === 1 || param === 2) style = 'block';
    if (param === 3 || param === 4) style = 'underline';
    if (param === 5 || param === 6) style = 'bar';
    blink = param % 2 === 1;
  };
  const apply = (): void => {
    const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
    const theme: ITheme = {
      foreground: css(colors.foreground),
      background: css(colors.background),
      cursor: css(colors.cursor),
      extendedAnsi: colors.palette.slice(16).map(css),
    };
    for (const [index, name] of ansiNames.entries()) theme[name] = css(colors.palette[index]!);
    terminal.options.theme = theme;
  };
  const report = (command: string, color: number): void => {
    const channels = [color >> 16, (color >> 8) & 255, color & 255];
    const rgb = channels.map((value) => value.toString(16).padStart(2, '0').repeat(2)).join('/');
    reply(new TextEncoder().encode(`\x1b]${command};rgb:${rgb}\x1b\\`));
  };
  const colorCommand = (code: number, data: string): void => {
    if (code === 4) {
      const slots = data.split(';');
      for (let i = 0; i + 1 < slots.length; i += 2) {
        const index = colorIndex(slots[i]!);
        if (index === undefined) continue;
        const value = slots[i + 1]!;
        if (value === '?') report(`4;${index}`, colors.palette[index]!);
        else {
          const color = parseColor(value);
          if (color === undefined) continue;
          const palette = [...colors.palette];
          palette[index] = color;
          colors = { ...colors, palette };
          apply();
        }
      }
    } else if (code === 104) {
      const palette = [...colors.palette];
      if (data === '') palette.splice(0, palette.length, ...base.palette);
      else
        for (const slot of data.split(';')) {
          const index = colorIndex(slot);
          if (index !== undefined) palette[index] = base.palette[index]!;
        }
      colors = { ...colors, palette };
      apply();
    } else if (code >= 110) {
      const key = defaults[code - 110]!;
      colors = { ...colors, [key]: base[key] };
      apply();
    } else {
      const slots = data.split(';');
      for (let i = 0; i < slots.length && code + i <= 12; i++) {
        const key = defaults[code + i - 10]!;
        const value = slots[i]!;
        if (value === '?') report(String(code + i), colors[key]);
        else {
          const color = parseColor(value);
          if (color === undefined) continue;
          colors = { ...colors, [key]: color };
          apply();
        }
      }
    }
  };
  const text = (): string => {
    const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
    let text = '';
    for (const [index, color] of colors.palette.entries()) {
      if (color !== base.palette[index]) text += `\x1b]4;${index};${hex(color)}\x1b\\`;
    }
    for (const [offset, key] of defaults.entries()) {
      if (colors[key] !== base[key]) text += `\x1b]${10 + offset};${hex(colors[key])}\x1b\\`;
    }
    if (title !== '') text += `\x1b]2;${title}\x1b\\`;
    if (style !== undefined) text += `\x1b[${cursorShapes.indexOf(style) * 2 + (blink === true ? 1 : 2)} q`;
    return text;
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      failure = new AppearanceUnavailable({ cause: 'appearance scope is closed' });
    }),
  );
  const register = (acquire: () => IDisposable) =>
    Effect.acquireRelease(Effect.try({ try: acquire, catch: (cause) => new AppearanceUnavailable({ cause }) }), (handler) =>
      Effect.sync(() => handler.dispose()),
    );
  yield* Effect.try({
    try: () => {
      terminal.options.vtExtensions = { ...terminal.options.vtExtensions, colorSchemeQuery: false };
      apply();
    },
    catch: (cause) => new AppearanceUnavailable({ cause }),
  });
  for (const code of [4, 10, 11, 12, 104, 110, 111, 112]) {
    yield* register(() =>
      terminal.parser.registerOscHandler(code, (data) => {
        if (!failure) {
          try {
            colorCommand(code, data);
          } catch (cause) {
            failure = new AppearanceUnavailable({ cause });
          }
        }
        return true;
      }),
    );
  }
  yield* register(() =>
    terminal.onTitleChange((changed) => {
      title = changed;
    }),
  );
  yield* register(() =>
    terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
      const param = params.length === 0 ? 1 : params[0];
      if (typeof param === 'number') cursorStyle(param);
      return false;
    }),
  );
  yield* register(() =>
    terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      resetCursor();
      return false;
    }),
  );
  yield* register(() =>
    terminal.parser.registerEscHandler({ final: 'c' }, () => {
      resetCursor();
      return false;
    }),
  );
  return {
    snapshot: () =>
      Effect.suspend(() =>
        failure
          ? failure
          : Effect.succeed<ScreenAppearance>({
              colors: { ...colors, palette: [...colors.palette] },
              title,
              cursor: {
                visible: terminal.modes.showCursor,
                style: style ?? terminal.options.cursorStyle ?? 'block',
                blink: blink ?? terminal.options.cursorBlink ?? false,
              },
            }),
      ),
    checkpoint: () => Effect.suspend(() => (failure ? failure : Effect.succeed(text()))),
    reset: () => Effect.sync(resetCursor),
  };
});

export type Appearance = Effect.Success<ReturnType<typeof makeAppearance>>;

const colorIndex = (value: string): number | undefined => {
  if (!/^\d+$/.test(value)) return;
  const index = Number(value);
  return index < 256 ? index : undefined;
};
const parseColor = (value: string): number | undefined => {
  const color = value.toLowerCase();
  let channels: string[];
  let scaled: boolean;
  if (color.startsWith('rgb:')) {
    channels = color.slice(4).split('/');
    scaled = true;
    if (channels.length !== 3 || !channels.every((part) => /^[\da-f]{1,4}$/.test(part) && part.length === channels[0]!.length)) return;
  } else if (/^#[\da-f]+$/.test(color) && [4, 7, 10, 13].includes(color.length)) {
    const width = (color.length - 1) / 3;
    channels = [color.slice(1, 1 + width), color.slice(1 + width, 1 + width * 2), color.slice(1 + width * 2)];
    scaled = false;
  } else return;
  let result = 0;
  for (const channel of channels) {
    const value = Number.parseInt(channel, 16);
    const byte = scaled
      ? Math.round((value * 255) / (16 ** channel.length - 1))
      : channel.length === 1
        ? value << 4
        : value >> ((channel.length - 2) * 4);
    result = result * 256 + byte;
  }
  return result;
};
