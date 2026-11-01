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

export const HOST_BRIDGE = [
  bridgeMethod({
    id: 'open',
    notifications: [],
    signature: '{threadId, beside?} | {section: <view>} | {pane: <view>}',
    description: 'Opens a thread, or a section or pane the app contributes; only during a click inside the view.',
  }),
  bridgeMethod({
    id: 'storage/get',
    notifications: [],
    signature: '{key}',
    description: 'Answers `{stored, value?}`. The values stand in the app’s data directory, shared by all its views, projects and devices.',
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
] as const;

export type HostMethod = (typeof HOST_BRIDGE)[number]['id'];

export const capabilityOf = (id: string): string => `tagma/${id.split('/')[0]}`;
