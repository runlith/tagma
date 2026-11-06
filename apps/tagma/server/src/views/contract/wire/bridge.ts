type BridgeReference = {
  readonly title: string;
  readonly text: string;
};

export type BridgeMethod = {
  readonly id: string;
  readonly notifications: readonly string[];
  readonly signature: string;
  readonly description: string;
  readonly reference?: BridgeReference;
};

export const bridgeMethod = <const M extends BridgeMethod>(method: M): M => method;

export const THREAD_CHANGED = 'tagma/notifications/thread';

export const TRANSCRIPT_CHANGED = 'tagma/notifications/transcript';

export const HOST_BRIDGE = [
  bridgeMethod({
    id: 'open',
    notifications: [],
    signature: '{threadId, beside?} | {section: <view>} | {pane: <view>}',
    description: 'Opens a thread, or a section or pane the plugin contributes; only during a click inside the view.',
  }),
  bridgeMethod({
    id: 'storage/get',
    notifications: [],
    signature: '{key}',
    description:
      'Answers `{stored, value?}`. The values stand in the plugin’s data directory, shared by all its views, projects and devices.',
  }),
  bridgeMethod({
    id: 'storage/set',
    notifications: [],
    signature: '{key, value}',
    description: 'Keeps a JSON value of at most 1 MiB; without `value` it removes the key.',
  }),
  bridgeMethod({
    id: 'thread',
    notifications: [THREAD_CHANGED],
    signature: '{threadId}',
    description:
      'Answers `{threadId, life, runId, text, ended}` — whether a run is going, the reply as it streams or the last line said, how the last run ended — or `{threadId, missing}`; each change follows as the notification until `tagma/thread/unwatch` or teardown.',
  }),
  bridgeMethod({
    id: 'thread/unwatch',
    notifications: [],
    signature: '{threadId}',
    description: 'Stops the change notifications of a thread the view watches.',
  }),
  bridgeMethod({
    id: 'transcript',
    notifications: [TRANSCRIPT_CHANGED],
    signature: '{threadId}',
    description:
      'Answers the newest page of one thread’s transcript as the event `{type: "initial", threadId, entries, more, tail}`; each change follows as the notification, an event with the same `threadId`, until `tagma/transcript/unwatch` or teardown. A notification can arrive before the answer is read: hold it until the answer lands.',
    reference: {
      title: 'The transcript of a thread',
      text: [
        'A view reads one thread’s transcript through `tagma/transcript`, in the thread’s own project, and pages back with `tagma/transcript/older`.',
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
        '',
        'Events, all carrying `threadId`:',
        '- `initial {entries, more, tail}` — the newest entries, oldest first, `more` when older ones exist, and what is still being written (`tail`); it also arrives again as a notification when the list was rearranged, and replaces everything held;',
        '- `entry {entry}` — an entry added or changed: one with a known `id` replaces it in place, a new one goes at the end of the list. A tool call whose input is complete is a `running` entry, sent again when it ends;',
        '- `removed {ids}` — entries withdrawn or rewound;',
        '- `tail {tail}` — what is still being written, drawn after the list: the reply as it streams and a tool call whose input is arriving. `{restart: true, entries}` replaces the whole tail (`entries: []` when nothing is), `{restart: false, id, text}` appends `text` to the reply `id`. An entry that is finished arrives as `entry` and leaves the tail.',
        '',
        'The answer of `tagma/transcript/older` is `{threadId, entries, more}`: the entries before the oldest the view holds, to put in front of them.',
      ].join('\n'),
    },
  }),
  bridgeMethod({
    id: 'transcript/older',
    notifications: [],
    signature: '{threadId}',
    description:
      'Answers `{threadId, entries, more}` — the page before the oldest entry the view holds — for a thread watched with `tagma/transcript`.',
  }),
  bridgeMethod({
    id: 'transcript/unwatch',
    notifications: [],
    signature: '{threadId}',
    description: 'Stops the transcript notifications of a thread the view watches.',
  }),
] as const;

export type HostMethod = (typeof HOST_BRIDGE)[number]['id'];

export const capabilityOf = (id: string): string => `tagma/${id.split('/')[0]}`;
