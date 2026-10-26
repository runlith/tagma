import { appendFileSync, existsSync, renameSync, watch, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Option = { readonly value: string; readonly label: string };

const OPTIONS: readonly Option[] = [
  { value: '1', label: 'Yes  (Approve once)' },
  { value: '2', label: 'Yes, allow fetches to wttr.in/*' },
  { value: '3', label: 'Yes, always allow fetches to wttr.in/*' },
  { value: '4', label: 'Yes, always allow all web fetches' },
  { value: '5', label: 'Yes, switch to bypass mode' },
  { value: '6', label: 'No' },
];

const MOVED: readonly Option[] = [
  { value: '1', label: 'Yes  (Approve once)' },
  { value: '2', label: 'No' },
];

const FOOTER = '↑↓ select · ↵ confirm · esc cancel';
const ASKED = 'Fetching https://wttr.in/Belgrade?format=%t+%C';
const MOVED_ASKED = 'Running command: rm -rf build';

const CLAUDE_OPTIONS: readonly Option[] = [
  { value: '1', label: 'Yes' },
  { value: '2', label: "Yes, and don't ask again for rm commands in /opt/workspaces/runlith" },
  { value: '3', label: 'No, and tell Claude what to do differently (esc)' },
];
const CLAUDE_ASKED = 'Bash(rm -rf build)';

type Shape = {
  readonly asked: string;
  readonly options: readonly Option[];
  readonly footer: string | null;
  readonly row: (option: Option, at: number, cursor: number) => string;
  readonly head: (asked: string) => readonly string[];
};

const SHAPES: Record<string, Shape> = {
  devin: {
    asked: ASKED,
    options: OPTIONS,
    footer: FOOTER,
    row: (option, at, cursor) => `${at === cursor ? '❭' : '·'} ${option.value} ${option.label}`,
    head: (asked) => [
      '',
      '⠀⣴⣾⣶⡄⠀⠀⠀⠀',
      '⠀⠛⠿⠟⠻⣶⣾⣶⡄  Devin CLI',
      '⠀⣤⣶⣦⣴⠿⢿⠿⠃  v3000.10.27',
      '⠀⠻⢿⠿⠃⠀⠀⠀⠀',
      '',
      '❭ What is the weather in Belgrade right now?',
      '',
      'Pro · 99% remaining (resets in 3d 7h)',
      '',
      ' ⏺ Invoked skill web-search',
      '',
      ` ⏺ ${asked}`,
      '',
    ],
  },
  claude: {
    asked: CLAUDE_ASKED,
    options: CLAUDE_OPTIONS,
    footer: null,
    row: (option, at, cursor) => `${at === cursor ? '❯' : ' '} ${option.value}. ${option.label}`,
    head: (asked) => ['', '❯ remove the build directory', '', asked, ''],
  },
};

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};

const report = flag('--report');
if (report === undefined) {
  process.stderr.write('askWidgetProgram needs --report <path>\n');
  process.exit(2);
}

const keysPath = `${report}.keys`;
const dismissPath = `${report}.dismiss`;

writeFileSync(keysPath, '');

const shape = SHAPES[flag('--shape') ?? 'devin'];
if (shape === undefined) {
  process.stderr.write(`askWidgetProgram knows no shape ${flag('--shape') ?? ''}\n`);
  process.exit(2);
}

const truncated = process.argv.includes('--truncate');

let screen: Shape = truncated ? { ...shape, options: shape.options.slice(0, -1), footer: null } : shape;
let cursor = 0;
let moves = 0;
const started = shape.options[0]!.value;
let taken = false;

const out = (text: string): void => {
  process.stdout.write(text);
};

const head = (): readonly string[] => screen.head(screen.asked);

const optionRow = (option: Option, at: number): string => screen.row(option, at, cursor);

const draw = (): void => {
  const rows = [...head(), ...screen.options.map(optionRow), ...(screen.footer === null ? [] : [screen.footer])];
  out(`\x1b[2J\x1b[H${rows.join('\r\n')}`);
};

let painting = false;

const paint = async (pace: number): Promise<void> => {
  painting = true;
  out(`\x1b[2J\x1b[H${head().join('\r\n')}`);
  for (const [at, option] of screen.options.entries()) {
    await Bun.sleep(pace);
    out(`\r\n${optionRow(option, at)}`);
  }
  if (screen.footer !== null) {
    await Bun.sleep(pace);
    out(`\r\n${screen.footer}`);
  }
  painting = false;
};

const drawTaken = (answer: string | null): void => {
  out(`\x1b[2J\x1b[H ⏺ ${answer === null ? 'Cancelled' : `Approved: ${answer}`}\r\n\r\nWorking…\r\n`);
};

const writeReport = (record: unknown): void => {
  const staging = join(dirname(report), `.${Date.now()}.report`);
  writeFileSync(staging, JSON.stringify(record));
  renameSync(staging, report);
};

const confirm = (): void => {
  if (taken) return;
  taken = true;
  const chosen = screen.options[cursor]!.value;
  drawTaken(chosen);
  writeReport({ taken: chosen, from: started, moves, cancelled: false });
};

const cancel = (): void => {
  if (taken) return;
  taken = true;
  drawTaken(null);
  writeReport({ taken: null, from: started, moves, cancelled: true });
};

const key = (name: string): void => {
  appendFileSync(keysPath, `${painting ? `during-paint:${name}` : name}\n`);
  if (painting) return;
  if (name === 'up' && cursor > 0) {
    cursor -= 1;
    moves += 1;
    draw();
    return;
  }
  if (name === 'down' && cursor < screen.options.length - 1) {
    cursor += 1;
    moves += 1;
    draw();
    return;
  }
  if (name === 'enter') confirm();
  if (name === 'esc') cancel();
};

const strokes = (chunk: string): void => {
  let at = 0;
  while (at < chunk.length) {
    const rest = chunk.slice(at);
    if (rest.startsWith('\x1b[A') || rest.startsWith('\x1bOA')) {
      key('up');
      at += 3;
      continue;
    }
    if (rest.startsWith('\x1b[B') || rest.startsWith('\x1bOB')) {
      key('down');
      at += 3;
      continue;
    }
    const char = rest[0]!;
    if (char === '\x1b') {
      key('esc');
      at += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      key('enter');
      at += 1;
      continue;
    }
    key(`other:${char.codePointAt(0)!.toString(16)}`);
    at += char.length;
  }
};

const moved = (): void => {
  if (taken) return;
  screen = { ...SHAPES.devin!, asked: MOVED_ASKED, options: MOVED };
  cursor = 0;
  draw();
};

const watcher = watch(dirname(dismissPath), () => {
  if (existsSync(dismissPath)) moved();
});

const leave = (code: number): void => {
  watcher.close();
  process.exit(code);
};
process.stdin.on('end', () => leave(0));
process.stdin.on('close', () => leave(0));
process.stdin.on('error', () => leave(0));

setTimeout(() => leave(0), 120_000);

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => strokes(chunk));
process.stdin.resume();

const pace = Number(flag('--paint') ?? '0');
if (Number.isFinite(pace) && pace > 0) void paint(pace);
else draw();
