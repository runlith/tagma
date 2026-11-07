import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText, PROVIDERS_ENTRY } from '../../../plugin-formats/tagma/testing/folder.js';

export const QUILL = {
  harness: 'quill',
  label: 'Quill',
  name: 'quill-plugin',
  version: '1.0.0',
  binary: 'quill',
  install: 'npm install --global quill-cli',
  hooks: '.quill/hooks.json',
  model: 'quill-1',
  close: 'quill.close',
} as const;

const ASKS = `(lines) => {
  const line = lines.find((text) => text.startsWith('quill asks: '));
  return line === undefined
    ? null
    : { kind: 'choice', prompt: line.slice('quill asks: '.length).trim(), header: null, subject: null, options: [{ value: 'yes', label: 'Yes' }], selected: null };
}`;

const adapterText = (close: string, screen: boolean) => `
import { defineAdapter } from '@runlith/tagma/adapter/provider';
import { emptyValues, fileSource } from '@runlith/tagma/adapter/metadata';

const quill = (key, text) => JSON.stringify({ quill: { [key]: text } });

const codec = {
  file: {
    keys: { quill: 2 },
    events: ['signals'],
    holes: false,
    trust: null,
    entry: (command, timeout) => ({ hooks: [{ type: 'command', command, ...(timeout === undefined ? {} : { timeout }) }] }),
  },
  permission: ({ allowed, words }) => JSON.stringify({ quill: { verdict: allowed ? 'yes' : 'no', why: words } }),
  context: (text) => quill('context', text),
  tool: (text, moment) => quill(moment, text),
  prompt: (text) => quill('prompt', text),
};

const named = (event, key) => (typeof event[key] === 'string' ? event[key] : null);

const metadata = {
  sources: (input) => [
    fileSource(
      input.cwd,
      input.transcriptPath,
      {
        empty: emptyValues,
        line: (values, text) =>
          text.startsWith('quill:model=')
            ? { ...values, model: { value: text.slice('quill:model='.length), claim: 'last-recorded', turnId: null } }
            : values,
      },
      ['model'],
    ),
  ],
  provenance: { model: { source: 'transcript', readable: true }, effort: null, title: null },
};

const launch = {
  permission: { tagma: [] },
  model: null,
  interactive: (prompt) => ['${QUILL.binary}', ...(prompt === undefined ? [] : ['--say', prompt])],
  resume: (key, prompt) => ['${QUILL.binary}', '--resume', key, ...(prompt === undefined ? [] : ['--say', prompt])],
  root: (argv) => {
    const at = argv.indexOf('--resume');
    return at < 0 ? null : (argv[at + 1] ?? null);
  },
};

const program = {
  command: '/bin/sh',
  schemas: false,
  argv: (ask) => [import.meta.dir + '/ask.sh', ask.model],
  answer: ({ stdout, stderr, exit }) =>
    exit === 0 && stdout.trim() !== ''
      ? { _tag: 'Text', text: stdout.trim() }
      : { _tag: 'Refused', refusal: 'ask-provider-failed', message: (stderr || stdout).trim() || 'quill answered nothing' },
};

export const adapter = defineAdapter(() => [
  {
    id: '${QUILL.harness}',
    label: '${QUILL.label}',
    kind: 'harness',
    auth: 'cli',
    environment: () => [],
    models: {
      '${QUILL.model}': { label: 'Quill', capabilities: ['text'], capacity: { context: 32000 }, reasoning: [], defaultReasoning: null },
    },
    defaultTextModel: '${QUILL.model}',
    asks: { program },
    cacheLifetime: { promisedSeconds: null, prior: null },
    terminal: {
      prefix: 'quill',
      binary: '${QUILL.binary}',
      install: '${QUILL.install}',
      tools: { names: 'vendor', byName: {} },
      hooks: {
        file: '${QUILL.hooks}',
        codec,
        events: {
          sessionStart: 'quill.open',
          preWrite: 'quill.before',
          postWrite: 'quill.after',
          postRead: 'quill.after',
          stop: '${close}',
          permission: 'quill.ask',
          prompt: 'quill.said',
        },
        user: null,
        context: { chars: 4000, basis: 'unmeasured' },
        promptContext: true,
      },
      mcpTools: 'catalog',
      mcp: null,
      occasionOf: ({ name }) =>
        name === 'quill.open' ? 'session-start' : name === 'quill.said' ? 'turn-start' : name === '${close}' ? 'turn-end' : 'activity',
      sessionKeyOf: (event) => named(event, 'quill_session'),
      modelOf: () => null,
      reportsModel: false,
      turnOf: (event) => named(event, 'quill_turn'),
      answerKey: 'quill_answer',
      promptKey: 'quill_prompt',
      subjectOf: (event) =>
        named(event, 'quill_tool') === null ? null : { id: null, tool: event.quill_tool, subject: JSON.stringify(event.quill_input ?? {}) },
      filesOf: (event) => {
        const path = named(event, 'quill_file');
        return path === null ? [] : [{ effect: event.quill_tool === 'look' ? 'read' : 'write', path }];
      },
      printedOf: () => null,
      eventKeys: ['hook_event_name', 'quill_session', 'quill_turn', 'quill_tool'],
      screenAskOf: ${screen ? ASKS : '() => null'},
      keysOf: () => null,
      cancelKeysOf: () => null,
      interrupt: [{ _tag: 'char', char: '\\u0003' }],
      steer: 'none',
      quit: null,
      callEnvelopeMs: null,
      ends: { interrupt: 'record', idle: null, tail: 'final' },
      metadata,
      launch,
    },
  },
]);

export default { models: adapter };
`;

const askText = `#!/bin/sh
here=$(dirname "$0")
input=$(cat)
case "$input" in
  wait:*)
    gate=\${input#wait:}
    : > "$gate.asked"
    while [ ! -e "$gate" ]; do sleep 0.05; done
    ;;
esac
cat "$here/answer.txt"
`;

const cliText = `#!/bin/sh
echo "quill ready"
while IFS= read -r line; do echo "quill heard: $line"; done
`;

export type QuillPackage = { readonly directory: string; readonly bin: string };

export const quillRelease = Effect.fn('quill.release')(function* (
  directory: string,
  version: string,
  close: string = QUILL.close,
  screen = true,
) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(join(directory, 'dist'), { recursive: true });
  yield* files.writeFileString(join(directory, 'dist/answer.txt'), `quill ${version}\n`);
  yield* files.writeFileString(join(directory, 'dist/ask.sh'), askText);
  yield* files.writeFileString(join(directory, PROVIDERS_ENTRY), adapterText(close, screen));
  yield* files.writeFileString(
    join(directory, MANIFEST),
    manifestText({ id: QUILL.name, title: QUILL.label, version, providers: { models: true, harnesses: true, speech: false } }),
  );
});

export const quillPackage = Effect.fn('quill.package')(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  const directory = join(root, QUILL.name);
  const bin = join(root, 'quill-bin');
  yield* files.makeDirectory(directory, { recursive: true });
  yield* files.makeDirectory(bin, { recursive: true });
  yield* quillRelease(directory, QUILL.version);
  yield* files.writeFileString(join(bin, QUILL.binary), cliText, { mode: 0o755 });
  return { directory, bin } satisfies QuillPackage;
});
