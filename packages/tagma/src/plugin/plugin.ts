import type { McpCaller } from '@runlith/mcp/caller';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { ExternalOperations } from './operations.generated.js';
import type { PluginEnvelope, PluginPoints } from './points.generated.js';
import type { BuildStepInput, BuildVerdict, EndingInput, NotificationInput, TickInput } from './protocol.js';

export type InputSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>;

export type OperationId = keyof ExternalOperations & string;

export type TagmaClient = {
  readonly op: <Id extends OperationId>(id: Id, input: ExternalOperations[Id]['input']) => Promise<ExternalOperations[Id]['answer']>;
  readonly in: (project: number) => TagmaClient;
};

export type PluginContext = {
  readonly caller: McpCaller;
  readonly project: number | null;
  readonly projects: readonly number[];
  readonly tagma: TagmaClient;
  readonly data: string;
  readonly dataOf: (project: number | null) => string;
  readonly options: Readonly<Record<string, string | undefined>>;
  readonly log: (...parts: readonly unknown[]) => void;
  readonly signal: AbortSignal;
  readonly changed: (uri: string) => void;
};

type ToolEntry = PluginPoints['tools'][number];

export type ToolAudience = Exclude<ToolEntry['audience'], 'tagma'>;

type Parsed<S> = S extends StandardSchemaV1<any, infer Output> ? Output : { readonly [key: string]: unknown };

export type Tool<S extends InputSchema | undefined = InputSchema | undefined> = {
  readonly description: ToolEntry['description'];
  readonly audience: ToolAudience;
  readonly input?: S;
  readonly title?: string;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
  readonly run: (input: Parsed<S>, ctx: PluginContext) => Promise<unknown>;
};

export type Resource = {
  readonly uri: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly read: (params: Readonly<Record<string, string>>, ctx: PluginContext) => Promise<unknown>;
};

export type Every = number | `${number}${'s' | 'm' | 'h' | 'd'}`;

export type Schedule = {
  readonly every: Every;
  readonly run: (tick: TickInput, ctx: PluginContext) => Promise<void>;
};

export type BuildStep = {
  readonly title: PluginPoints['beforeBuild'][number]['title'];
  readonly run: (step: BuildStepInput, ctx: PluginContext) => Promise<BuildVerdict>;
};

export type EndingHandler = (ending: EndingInput, ctx: PluginContext) => Promise<void>;

export type NotificationHandler = (answer: NotificationInput, ctx: PluginContext) => Promise<void>;

export type HandledPoint = 'tools' | 'schedule' | 'beforeBuild' | 'on' | 'notify';

export type PluginData = { readonly [Point in Exclude<keyof PluginPoints, HandledPoint>]?: PluginPoints[Point] };

export type PluginDefinition = PluginData & {
  readonly id: PluginEnvelope['id'];
  readonly title: PluginEnvelope['title'];
  readonly description?: PluginEnvelope['description'];
  readonly resident?: NonNullable<PluginEnvelope['process']>['resident'];
  readonly options?: PluginEnvelope['options'];
  readonly tools?: Readonly<Record<string, Tool<any>>>;
  readonly resources?: Readonly<Record<string, Resource>>;
  readonly schedules?: Readonly<Record<string, Schedule>>;
  readonly beforeBuild?: Readonly<Record<string, BuildStep>>;
  readonly onThreadEnded?: EndingHandler;
  readonly onNotification?: NotificationHandler;
};

export const definePlugin = <const Definition extends PluginDefinition>(definition: Definition): Definition => definition;

export const tool = <S extends InputSchema | undefined = undefined>(declared: Tool<S>): Tool<S> => declared;

export const resource = (declared: Resource): Resource => declared;

export const schedule = (declared: Schedule): Schedule => declared;

export const beforeBuild = (declared: BuildStep): BuildStep => declared;

export const onThreadEnded = (handler: EndingHandler): EndingHandler => handler;

export const onNotification = (handler: NotificationHandler): NotificationHandler => handler;

export class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'Refusal';
  }
}

export class TagmaRefused extends Error {
  constructor(
    readonly operation: string,
    readonly code: string,
    readonly reason: string,
    readonly unblock: readonly string[],
  ) {
    super(`${operation} refused ${code}: ${reason}`);
    this.name = 'TagmaRefused';
  }
}
