import type { HandledPoint, PluginData, PluginDefinition, Tool } from './plugin.js';
import { type PluginEnvelope, type PluginPoints, POINT_NAMES } from './points.generated.js';
import { handlerTools, RESERVED_PREFIX } from './protocol.js';

type ToolEntry = PluginPoints['tools'][number];

export type PluginDescription = {
  readonly id: PluginEnvelope['id'];
  readonly title: PluginEnvelope['title'];
  readonly description: PluginEnvelope['description'];
  readonly options: PluginEnvelope['options'];
  readonly process: { readonly resident: boolean } | null;
  readonly tools: PluginPoints['tools'];
  readonly contributes: Partial<PluginPoints>;
};

export const PROCESS_ENTRY = 'dist/process.js';

type PluginManifest = Omit<PluginEnvelope, 'version' | 'build'>;

export const manifestOf = (described: PluginDescription): PluginManifest => ({
  id: described.id,
  title: described.title,
  description: described.description,
  process: described.process === null ? undefined : { entry: PROCESS_ENTRY, resident: described.process.resident || undefined },
  options: described.options,
  contributes: described.contributes,
});

export class PluginInvalid extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PluginInvalid';
  }
}

const NAME = /^[a-zA-Z0-9_-]+$/u;

const EVERY = /^(\d+(?:\.\d+)?)(s|m|h|d)$/u;

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

const TAGMA_INPUT = { type: 'object' } as const;

const named = (kind: string, name: string): string => {
  if (!NAME.test(name)) throw new PluginInvalid(`the ${kind} ${JSON.stringify(name)} is named with letters, digits, _ and - only`);
  return name;
};

const everyMs = (name: string, every: number | string): number => {
  if (typeof every === 'number') return every;
  const parsed = EVERY.exec(every);
  if (parsed === null)
    throw new PluginInvalid(`the schedule ${name} runs every ${JSON.stringify(every)}: give milliseconds or a number with s, m, h or d`);
  return Math.round(Number(parsed[1]) * UNIT_MS[parsed[2] as keyof typeof UNIT_MS]);
};

const inputSchemaOf = (name: string, declared: Tool['input']): ToolEntry['inputSchema'] => {
  if (declared === undefined) return { type: 'object', properties: {}, additionalProperties: false };
  const { $schema: _, ...schema } = declared['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  if (schema.type !== 'object') throw new PluginInvalid(`the input of the tool ${name} is not an object schema`);
  return { ...schema, type: 'object' };
};

const authored = (name: string, declared: Tool): ToolEntry => {
  if (named('tool', name).startsWith(RESERVED_PREFIX))
    throw new PluginInvalid(`the tool ${name} starts with ${RESERVED_PREFIX}, which names the SDK's own tools`);
  const annotations = {
    title: declared.title,
    readOnlyHint: declared.readOnly,
    destructiveHint: declared.destructive,
    idempotentHint: declared.idempotent,
    openWorldHint: declared.openWorld,
  };
  return {
    name,
    audience: declared.audience,
    description: declared.description,
    inputSchema: inputSchemaOf(name, declared.input),
    annotations: Object.values(annotations).some((value) => value !== undefined) ? annotations : undefined,
  };
};

const tagmaTool = (name: string, description: string): ToolEntry => ({ name, audience: 'tagma', description, inputSchema: TAGMA_INPUT });

const HANDLED_BY: Readonly<Record<HandledPoint, keyof PluginDefinition>> = {
  tools: 'tools',
  schedule: 'schedules',
  beforeBuild: 'beforeBuild',
  on: 'onThreadEnded',
  notify: 'onNotification',
};

const HANDLED: ReadonlySet<string> = new Set(Object.keys(HANDLED_BY));

const OWN: Readonly<Record<Exclude<keyof PluginDefinition, keyof PluginData>, true>> = {
  id: true,
  title: true,
  description: true,
  resident: true,
  options: true,
  tools: true,
  resources: true,
  schedules: true,
  beforeBuild: true,
  onThreadEnded: true,
  onNotification: true,
};

const FIELDS: readonly string[] = [...Object.keys(OWN), ...POINT_NAMES.filter((point) => !HANDLED.has(point))];

const distance = (left: string, right: string): number => {
  let row = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1)
      next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[right.length]!;
};

const meant = (field: string): string | undefined => {
  if (Object.hasOwn(HANDLED_BY, field)) return HANDLED_BY[field as HandledPoint];
  const [nearest] = FIELDS.map((known) => ({ known, apart: distance(field.toLowerCase(), known.toLowerCase()) }))
    .filter(({ apart }) => apart <= 2)
    .sort((left, right) => left.apart - right.apart);
  return nearest?.known;
};

const unknownFields = (definition: PluginDefinition): void => {
  const unknown = Object.keys(definition).filter((field) => !FIELDS.includes(field));
  if (unknown.length === 0) return;
  const told = unknown.map((field) => {
    const known = meant(field);
    return known === undefined ? field : `${field} (write ${known})`;
  });
  throw new PluginInvalid(`definePlugin takes no field ${told.join(', ')}; its fields are ${FIELDS.join(', ')}`);
};

const dataOf = (definition: PluginDefinition): PluginData =>
  Object.fromEntries(
    POINT_NAMES.flatMap((point) => {
      const value = (definition as Readonly<Record<string, unknown>>)[point];
      return HANDLED.has(point) || value === undefined ? [] : [[point, value]];
    }),
  );

export const describePlugin = (definition: PluginDefinition): PluginDescription => {
  unknownFields(definition);
  const { id, title, description, options, resident, resources, schedules, beforeBuild, onThreadEnded, onNotification } = definition;
  const scheduled = Object.entries(schedules ?? {}).map(([name, declared]) => ({
    name: named('schedule', name),
    everyMs: everyMs(name, declared.every),
    tool: handlerTools.schedule(name),
  }));
  const steps = Object.entries(beforeBuild ?? {}).map(([name, step]) => ({
    tool: handlerTools.build(named('build step', name)),
    title: step.title,
  }));
  const tools: ToolEntry[] = [
    ...Object.entries(definition.tools ?? {}).map(([name, declared]) => authored(name, declared)),
    ...scheduled.map((entry) => tagmaTool(entry.tool, `Runs the schedule ${entry.name}.`)),
    ...steps.map((entry) => tagmaTool(entry.tool, `Runs the build step ${entry.title}.`)),
    ...(onThreadEnded === undefined ? [] : [tagmaTool(handlerTools.ended, 'Receives the end of a turn of a thread bound to this plugin.')]),
    ...(onNotification === undefined
      ? []
      : [tagmaTool(handlerTools.notification, 'Receives the answer to a notification this plugin sent.')]),
  ];
  const handled = tools.length > 0 || Object.keys(resources ?? {}).length > 0;
  const contributes: Partial<PluginPoints> = {
    ...dataOf(definition),
    ...(tools.length === 0 ? {} : { tools }),
    ...(scheduled.length === 0 ? {} : { schedule: scheduled }),
    ...(steps.length === 0 ? {} : { beforeBuild: steps }),
    ...(onThreadEnded === undefined ? {} : { on: { ended: handlerTools.ended } }),
    ...(onNotification === undefined ? {} : { notify: { tool: handlerTools.notification } }),
  };
  return { id, title, description, options, process: handled ? { resident: resident ?? false } : null, tools, contributes };
};
