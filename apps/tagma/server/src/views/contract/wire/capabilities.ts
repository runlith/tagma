type CapabilityReference = {
  readonly title: string;
  readonly text: string;
};

export type CapabilityDeclaration = {
  readonly id: string;
  readonly signature: string;
  readonly description: string;
  readonly reference?: CapabilityReference;
};

export const capability = <const C extends CapabilityDeclaration>(declared: C): C => declared;

const TRANSCRIPT_REFERENCE = [
  'A view reads one thread’s transcript, in the view’s own project, with `useTagma().transcript(threadId)`. It answers a reactive value: read its fields in markup or `$derived`, and the thread is followed while something reads them.',
  '',
  'Fields:',
  '- `entries` — the newest page, oldest first; `older()` puts the page before it in front and answers once it landed;',
  '- `more` — older entries exist;',
  '- `tail` — what is still being written, drawn after `entries`: the reply as it streams and a tool call whose input is arriving;',
  '- `loaded` — the first page arrived;',
  '- `failure` — why the thread could not be read, such as a thread deleted while followed; reading it again later opens it afresh.',
  '',
  'An entry is `{id, runId, role, sender?, text?, tool?, question?}`:',
  '- `runId` — the run that wrote it, `null` before one did;',
  '- `role` — `user`, `assistant`, `tool`, `question` or `notice` (a failure, an interruption, a run end or a system signal, in `text`);',
  '- `sender?` — `{name, threadId?}` when a thread or a program wrote the `user` words;',
  '- `text?` — the words;',
  '- `tool?` — `{name, state, input, output?}`, `state` one of `running`, `done`, `refused`, `failed`;',
  '- `question?` — `{id, prompts, answered}`, a question the agent asked the person.',
  '',
  'The model’s reasoning is not part of it.',
].join('\n');

export const TAGMA_VIEW = [
  capability({
    id: 'projectId',
    signature: ', plugin, view, threadId, key',
    description:
      'Where the view is mounted: its project, plugin and view, the thread of a tool card or pin (else null) and a pin’s key (else null).',
  }),
  capability({
    id: 'tools',
    signature: '.<name>(input)',
    description:
      'Calls one of the plugin’s own `view` tools and answers the handler’s value, typed with `useTagma<typeof plugin>()`; a refusal or a failed handler throws `TagmaRefused`.',
  }),
  capability({
    id: 'servers',
    signature: '.<name>.call(tool, input?)',
    description:
      'Calls a tool of an MCP server the plugin brought in its `mcpServers`, under that server’s sign-in in the view’s project, and answers its MCP result `{content, structuredContent?, isError?}`; a refusal throws `TagmaRefused`.',
  }),
  capability({
    id: 'resource',
    signature: '(uri)',
    description: 'A reactive `{current, failure}` of one of the plugin’s resources, read again on each `ctx.changed(uri)`.',
  }),
  capability({
    id: 'storage',
    signature: '.get(key) · .set(key, value?)',
    description:
      'Keeps JSON values of at most 1 MiB in the plugin’s data directory, shared by all its views, projects and devices; `get` answers `{stored, value?}`, `set` without a value removes the key.',
  }),
  capability({
    id: 'thread',
    signature: '(threadId)',
    description:
      'A reactive `{current, failure}`: `{threadId, life, runId, text, ended}` — whether a run is going, the reply as it streams or the last line said, how the last run ended — or `{threadId, missing}`.',
  }),
  capability({
    id: 'transcript',
    signature: '(threadId)',
    description: 'One thread’s transcript as a reactive value, paged back on demand.',
    reference: { title: 'The transcript of a thread', text: TRANSCRIPT_REFERENCE },
  }),
  capability({
    id: 'open',
    signature: '({threadId, beside?} | {section} | {pane})',
    description: 'Opens a thread, or a section or pane the plugin contributes.',
  }),
  capability({ id: 'openLink', signature: '(url)', description: 'Opens an `http` or `https` link outside Tagma.' }),
  capability({
    id: 'theme',
    signature: '',
    description: 'The theme in force, `{id, mode, terminal}`, as a reactive value, for a view that draws on a canvas.',
  }),
] as const;
