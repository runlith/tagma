import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
};

const SCHEMA_MARK = 'JSON Schema, and nothing else:\n';

const shouted = (text: string) =>
  text
    .split(/(⟦\d+⟧)/u)
    .map((piece) => (/^⟦\d+⟧$/u.test(piece) ? piece : piece.toUpperCase()))
    .join('');

const objectOf = (schema: { readonly properties?: Record<string, { readonly type?: string; readonly enum?: readonly unknown[] }> }) =>
  Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, field]) => [
      name,
      field.enum !== undefined ? field.enum.at(-1) : field.type === 'boolean' ? true : field.type === 'number' ? 1 : 'answered',
    ]),
  );

const system = flag('--system') ?? flag('--system-prompt') ?? '';
const input = await Bun.stdin.text();
const log = process.env.ASK_PROGRAM_LOG;
if (log !== undefined && log !== '')
  appendFileSync(
    log,
    `${JSON.stringify({
      model: flag('--model'),
      effort: flag('--effort'),
      bytes: Buffer.byteLength(input),
      account: process.env.ASK_PROGRAM_ACCOUNT ?? null,
      cwd: process.cwd(),
      pid: process.pid,
    })}\n`,
  );

if (input.includes('ASK-MOVING'))
  for (let beat = 0; beat < 25; beat += 1) {
    process.stdout.write('\n');
    await Bun.sleep(100);
  }

if (input.includes('ASK-HANG')) setInterval(() => {}, 1_000);
else if (input.includes('ASK-QUOTA')) {
  process.stderr.write('usage limit reached for this account');
  process.exit(2);
} else {
  const marked = system.indexOf(SCHEMA_MARK);
  const nativeSchema = flag('--json-schema');
  const schema =
    nativeSchema === null ? (marked === -1 ? null : JSON.parse(system.slice(marked + SCHEMA_MARK.length))) : JSON.parse(nativeSchema);
  const sections = [...input.matchAll(/^@@ (\d+)\n([\s\S]*?)\n(?=@@ |\s*$)/gmu)];
  const text =
    schema !== null
      ? input.includes('ASK-MALFORMED')
        ? JSON.stringify({ addressed: 'maybe' })
        : JSON.stringify(objectOf(schema))
      : /name conversations/u.test(system)
        ? 'TITLE: Program title'
        : sections.length > 0
          ? sections.map(([, id, part]) => `@@ ${id}\n«ru» ${shouted(part!)}`).join('\n')
          : input.includes('ASK-BYTES')
            ? String(Buffer.byteLength(input))
            : input.includes('ASK-OUTPUT')
              ? 'x'.repeat(1024 * 1024 + 512)
              : `## State\n${'The program read the conversation and kept its plan and every file it names. '.repeat(24).trim()}`;
  const usage = { input_tokens: Math.ceil(input.length / 4), output_tokens: Math.ceil(text.length / 4) };
  process.stdout.write(
    JSON.stringify(
      process.env.ASK_PROGRAM_FORMAT === 'claude'
        ? { type: 'result', subtype: 'success', result: text, structured_output: schema === null ? undefined : JSON.parse(text), usage }
        : { text, usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } },
    ),
  );
}
