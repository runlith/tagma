import { appendFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};

const report = flag('--report');
if (report === undefined) {
  process.stderr.write('askEditorProgram needs --report <path>\n');
  process.exit(2);
}

const brackets = flag('--brackets') !== 'off';

const busyPath = `${report}.busy`;
let busy = existsSync(busyPath);

const submittedPath = `${report}.submitted`;
const readsPath = `${report}.reads`;

writeFileSync(submittedPath, '');
writeFileSync(readsPath, '');

const BRACKET_START = '\x1b[200~';
const BRACKET_END = '\x1b[201~';
const BRACKETED_PASTE_ON = '\x1b[?2004h';
const BRACKETED_PASTE_OFF = '\x1b[?2004l';

let buffer = '';
let unclosed: string | null = null;
let submissions = 0;

const out = (text: string): void => {
  process.stdout.write(text);
};

const IDLE_PROMPT = '❭';
const BUSY_PROMPT = '⧖';
const EDITOR_ROW = 4;
const draw = (): void => {
  const prompt = busy ? `${BUSY_PROMPT} working, guide it while it works` : IDLE_PROMPT;
  const lead = `│ ${prompt} `;
  out(
    `\x1b[2J\x1b[H submitted ${submissions}\r\n\r\n╭──────────────────────────────────────────╮\r\n${lead}${buffer}\r\n╰──────────────────────────────────────────╯`,
  );
  out(`\x1b[${EDITOR_ROW};${[...lead].length + [...buffer].length + 1}H`);
};

const writeReport = (): void => {
  const staging = join(dirname(report), `.${Date.now()}.editor`);
  writeFileSync(staging, JSON.stringify({ submissions, buffer, busy, brackets }), { mode: 0o600 });
  renameSync(staging, report);
};

const submit = (): void => {
  if (sameRead) {
    appendFileSync(readsPath, 'return-discarded-same-admission\n');
    return;
  }
  if (busy) {
    appendFileSync(readsPath, 'return-discarded-busy\n');
    return;
  }
  if (buffer === '') {
    appendFileSync(readsPath, 'return-on-empty\n');
    return;
  }
  appendFileSync(submittedPath, `${buffer}\n`);
  submissions += 1;
  buffer = '';
  draw();
  writeReport();
};

const receive = (text: string): void => {
  if (text === '') return;
  unclosed = null;
  buffer += text;
  sameRead = true;
  draw();
  writeReport();
};

let sameRead = false;

const read = (chunk: string): void => {
  appendFileSync(readsPath, `${Date.now()} ${JSON.stringify(chunk)}\n`);
  sameRead = false;
  let rest = chunk;
  while (rest.length > 0) {
    const start = rest.indexOf(BRACKET_START);
    if (start === 0) {
      const end = rest.indexOf(BRACKET_END);
      if (end < 0) {
        unclosed = (unclosed ?? '') + rest.slice(BRACKET_START.length);
        return;
      }
      receive((unclosed ?? '') + rest.slice(BRACKET_START.length, end));
      rest = rest.slice(end + BRACKET_END.length);
      continue;
    }
    const char = rest[0]!;
    if (char === '\r' || char === '\n') {
      submit();
      rest = rest.slice(1);
      continue;
    }
    const control = rest.search(/[\r\n\x1b]/);
    const text = control < 0 ? rest : rest.slice(0, Math.max(control, 1));
    receive(text);
    rest = rest.slice(text.length);
  }
};

const watchTurn = setInterval(() => {
  const now = existsSync(busyPath);
  if (now === busy) return;
  busy = now;
  appendFileSync(readsPath, `${Date.now()} turn-${busy ? 'started' : 'ended'}\n`);
  draw();
  writeReport();
}, 20);

const leave = (code: number): void => {
  clearInterval(watchTurn);
  if (brackets) out(BRACKETED_PASTE_OFF);
  process.exit(code);
};
process.stdin.on('end', () => leave(0));
process.stdin.on('close', () => leave(0));
process.stdin.on('error', () => leave(0));
setTimeout(() => leave(0), 120_000);

process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => read(chunk));
process.stdin.resume();

if (brackets) out(BRACKETED_PASTE_ON);
draw();
writeReport();
