import { displayLanguage } from '@runlith/utils/codeLanguage';
import { textPatch } from '@runlith/utils/patch';
import { Schema } from 'effect';
import type { AgentThreadRef } from '../agent/contracts';

export const ToolDisplayFact = Schema.Struct({ label: Schema.String, value: Schema.optional(Schema.String) });

export const ToolDisplayItem = Schema.Struct({
  label: Schema.String,
  detail: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Literals(['answered', 'partial', 'failed'])),
  thread: Schema.optional(Schema.Struct({ id: Schema.String, projectId: Schema.optional(Schema.Int) })),
});

export const ToolDisplayReference = Schema.Union([
  Schema.Struct({
    kind: Schema.tag('thread'),
    id: Schema.String,
    projectId: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    kind: Schema.tag('command'),
    execution: Schema.String,
    incarnation: Schema.Int,
    operation: Schema.optional(Schema.String),
    standing: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.tag('call'),
    runId: Schema.String,
    toolCallId: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.tag('terminal'),
    execution: Schema.String,
    incarnation: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.tag('agent'),
    address: Schema.String,
    id: Schema.optional(Schema.String),
    projectId: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    kind: Schema.tag('agents'),
    recipients: Schema.Array(
      Schema.Struct({ address: Schema.String, id: Schema.optional(Schema.String), projectId: Schema.optional(Schema.Int) }),
    ),
  }),
  Schema.Struct({
    kind: Schema.tag('commit'),
    checkout: Schema.String,
    commit: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('kind'));

export const ToolDisplayImage = Schema.Struct({
  url: Schema.String,
  mediaType: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  label: Schema.optional(Schema.String),
});

export const ToolDisplayFilePatch = Schema.Struct({
  path: Schema.String,
  patch: Schema.String,
  added: Schema.Int,
  removed: Schema.Int,
  language: Schema.optional(Schema.String),
  timedOut: Schema.optional(Schema.Boolean),
});

export const ToolDisplayFiles = Schema.NonEmptyArray(ToolDisplayFilePatch);

export const ToolDisplayApp = Schema.Struct({
  server: Schema.String,
  identity: Schema.String,
  resource: Schema.String,
  tool: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const displayHead = {
  verb: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  alone: Schema.optional(Schema.Boolean),
  subtitle: Schema.optional(Schema.String),
  facts: Schema.optional(Schema.Array(ToolDisplayFact)),
  details: Schema.optional(Schema.Array(ToolDisplayFact)),
  mutates: Schema.optional(Schema.Boolean),
  awaitsMs: Schema.optional(Schema.Int),
  durationMs: Schema.optional(Schema.Int),
  opens: Schema.optional(Schema.Boolean),
  reference: Schema.optional(ToolDisplayReference),
  images: Schema.optional(Schema.Array(ToolDisplayImage)),
  app: Schema.optional(ToolDisplayApp),
};

export const ToolDisplay = Schema.Union([
  Schema.Struct({ ...displayHead, form: Schema.tag('none') }),
  Schema.Struct({ ...displayHead, form: Schema.tag('binary'), path: Schema.String, byteLength: Schema.Int }),
  Schema.Struct({ ...displayHead, form: Schema.tag('text'), text: Schema.String }),
  Schema.Struct({ ...displayHead, form: Schema.tag('markdown'), text: Schema.String }),
  Schema.Struct({ ...displayHead, form: Schema.tag('message'), text: Schema.String }),
  Schema.Struct({
    ...displayHead,
    form: Schema.tag('code'),
    text: Schema.String,
    path: Schema.optional(Schema.String),
    language: Schema.optional(Schema.String),
    firstLine: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    ...displayHead,
    form: Schema.tag('command'),
    command: Schema.String,
    output: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...displayHead,
    form: Schema.tag('diff'),
    files: ToolDisplayFiles,
  }),
  Schema.Struct({
    ...displayHead,
    form: Schema.tag('list'),
    items: Schema.Array(ToolDisplayItem),
    total: Schema.optional(Schema.Int),
  }),
]).pipe(Schema.toTaggedUnion('form'));

export const ToolDisplayMeta = Schema.Struct({ toolDisplay: ToolDisplay });

export type ToolDisplay = typeof ToolDisplay.Type;
export type ToolDisplayForm = ToolDisplay['form'];
export type ToolDisplayFact = typeof ToolDisplayFact.Type;
export type ToolDisplayItem = typeof ToolDisplayItem.Type;
export type ToolDisplayReference = typeof ToolDisplayReference.Type;
export type ToolDisplayImage = typeof ToolDisplayImage.Type;
export type ToolDisplayFilePatch = typeof ToolDisplayFilePatch.Type;
export type ToolDisplayFiles = typeof ToolDisplayFiles.Type;
export type ToolDisplayApp = typeof ToolDisplayApp.Type;

export function toolFilePatch(path: string, before: string, after: string): ToolDisplayFilePatch {
  const language = displayLanguage(path);
  const { patch, added, removed, timedOut } = textPatch(before, after);
  return { path, language: language || undefined, timedOut: timedOut || undefined, patch, added, removed };
}

export function mapFilePatches(files: ToolDisplayFiles, change: (file: ToolDisplayFilePatch) => ToolDisplayFilePatch): ToolDisplayFiles {
  const [first, ...rest] = files;
  return [change(first), ...rest.map(change)];
}

export function toolDisplayOpensByDefault(display: ToolDisplay): boolean {
  if (display.opens !== undefined) return display.opens;
  return display.form === 'diff';
}

export function referencedThreads(reference: ToolDisplayReference | undefined): readonly AgentThreadRef[] {
  switch (reference?.kind) {
    case 'agents':
      return reference.recipients.flatMap((recipient) =>
        recipient.id === undefined ? [] : [{ threadId: recipient.id, projectId: recipient.projectId, name: recipient.address }],
      );
    case 'agent':
      return reference.id === undefined ? [] : [{ threadId: reference.id, projectId: reference.projectId, name: reference.address }];
    case 'thread':
      return [{ threadId: reference.id, projectId: reference.projectId, name: null }];
    default:
      return [];
  }
}
