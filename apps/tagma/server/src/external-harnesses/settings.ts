import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey } from '../platform/contract/wire/setting.js';
import { harnessNameSchema } from '@runlith/tagma/adapter/harness';
import { harnessTransportSchema } from '../threads/contract/wire/harness/names.js';

export const harnessTitle = settingKey({
  id: 'threads.harnessTitle',
  order: 140,
  title: 'Let the CLI name its threads',
  description:
    "An external thread takes the title its CLI gives the session, and a later title from the CLI follows it — while Name threads automatically is on too. When either is off, a CLI whose harness can launch it without its own title call is launched without it, so nobody pays for a title nobody takes. Off with Name threads automatically on, Tagma names the thread from the operator's words when a turn begins. A name written by hand or generated is never replaced, and Generate title works either way.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const harnessTransport = settingKey({
  id: 'threads.harnessTransport',
  order: 141,
  title: 'Harness transport by vendor',
  description:
    'Which road a newly born thread of a foreign CLI takes, keyed by installed harness: `terminal` runs its CLI with hooks, `acp` drives its own agent from a held process. Only a harness offering both roads without hosting a Tagma agent takes a key. A CLI defaults to terminal when it supports it, otherwise ACP. Profiles that host Tagma ignore this setting: an explicit harness type opens the vendor’s own agent, and choosing their provider model opens the hosted chat.',
  schema: Schema.Record(harnessNameSchema, harnessTransportSchema),
  fallback: {},
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const harnessProfileSchema = Schema.Struct({
  home: Schema.optional(Schema.String.check(Schema.isStartingWith('/'))),
  plain: Schema.optional(Schema.Boolean),
  permissionMode: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
});
export type HarnessProfile = typeof harnessProfileSchema.Type;

export const harnessProfile = settingKey({
  id: 'threads.harnessProfile',
  order: 143,
  title: 'Harness profile by vendor',
  description:
    'What a newly born terminal thread of each foreign CLI runs on, keyed by installed harness with a terminal, kept by the thread for its whole life. `home` names the vendor configuration folder the CLI is launched with, through the home variable its harness declares, in place of a signed-in account. `plain` launches the CLI as it ships: Tagma installs no hooks, skill or MCP server into it, passes it no grant, and types each task as its sender wrote it; Tagma still starts it, shows its terminal, delivers words and reports the end of each turn, read from the vendor transcript. `permissionMode` launches the CLI in one of the permission modes its harness declares, in place of the bypass Tagma starts it with; the permission screens of the CLI then stand as questions to the parent of the thread. A vendor that cannot take a field refuses the birth and says why.',
  schema: Schema.Record(harnessNameSchema, harnessProfileSchema),
  fallback: {},
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const terminalChat = settingKey({
  id: 'threads.terminalChat',
  order: 142,
  title: 'Open terminal threads as a chat',
  description:
    "A thread driven in a terminal opens its terminal. On, it opens as a chat over the thread's journal instead: the words, the tool calls its hooks report and the closing answer of each turn.",
  schema: Schema.Boolean,
  fallback: false,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const EXTERNAL_HARNESS_SETTING_KEYS = [harnessTitle, harnessTransport, harnessProfile, terminalChat] as const;
