import type { McpCaller } from '@runlith/mcp/caller';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { ModelsClient } from './models.js';
import type { PluginServers, ServerClient } from './servers.js';
import type { ExternalOperations } from './operations.generated.js';
import type { BuildVerdict, HookVerdicts, PluginEnvelope, PluginPoints, ToolFaceState } from './points.generated.js';
import {
  type ActionInput,
  ASKED_LEFT,
  type AskedInput,
  type AskedLeft,
  type BuildStepInput,
  type EndingInput,
  type HookInput,
  type HookPoint,
  type NotificationInput,
  type TickInput,
} from './protocol.js';

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
  readonly models: ModelsClient;
  readonly servers: PluginServers;
  readonly data: string;
  readonly dataOf: (project: number | null) => string;
  readonly options: Readonly<Record<string, string | undefined>>;
  readonly log: (...parts: readonly unknown[]) => void;
  readonly signal: AbortSignal;
  readonly changed: (uri: string) => void;
};

type ToolEntry = PluginPoints['tools'][number];

export type ToolAudience = Exclude<ToolEntry['audience'], 'tagma'>;

type Parsed<S> = S extends StandardSchemaV1<any, infer Output> ? Output : Readonly<Record<never, never>>;

export type Tool<S extends InputSchema | undefined = InputSchema | undefined, A extends ToolAudience = ToolAudience, R = unknown> = {
  readonly description: ToolEntry['description'];
  readonly audience: A;
  readonly input?: S;
  readonly title?: string;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
  readonly run: (input: Parsed<S>, ctx: PluginContext) => Promise<R>;
};

type Encoded<S> = S extends StandardSchemaV1<infer Input, any> ? Input : Readonly<Record<never, never>>;

type ToolsOf<Plugin> = Plugin extends { readonly tools: infer Tools } ? Tools : Readonly<Record<never, never>>;

type ViewToolNames<Plugin> = {
  readonly [Name in keyof ToolsOf<Plugin>]: ToolsOf<Plugin>[Name] extends { readonly audience: 'view' } ? Name : never;
}[keyof ToolsOf<Plugin>];

type ToolIO<Handler> = Handler extends Tool<infer S, any, infer Output> ? { readonly input: Encoded<S>; readonly output: Output } : never;

export type ViewTools<Plugin> = {
  readonly [Name in ViewToolNames<Plugin>]: ToolIO<ToolsOf<Plugin>[Name]> extends {
    readonly input: infer Input;
    readonly output: infer Output;
  }
    ? keyof Input extends never
      ? (input?: Input) => Promise<Output>
      : (input: Input) => Promise<Output>
    : never;
};

type ServersOf<Plugin> = Plugin extends { readonly mcpServers: infer Servers } ? Servers : Readonly<Record<never, never>>;

export type ViewServers<Plugin> = { readonly [Name in keyof ServersOf<Plugin>]: ServerClient };

export type ToolFace<Plugin, Name extends keyof ToolsOf<Plugin> & string> = {
  readonly name: Name;
  readonly input: ToolIO<ToolsOf<Plugin>[Name]>['input'];
  readonly output: ToolIO<ToolsOf<Plugin>[Name]>['output'] | undefined;
  readonly state: ToolFaceState;
  readonly threadId: string;
};

export type ComposerFace = {
  readonly thread: {
    readonly id: string | null;
    readonly projectId: number;
    readonly status: 'idle' | 'working' | 'awaiting' | 'stalled' | null;
  };
  readonly draft: {
    readonly text: string;
    readonly setText: (text: string) => void;
    readonly insert: (text: string) => void;
    readonly attach: (files: readonly File[]) => Promise<void>;
  };
  readonly send: () => Promise<boolean>;
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

export type Action = {
  readonly title: PluginPoints['actions'][number]['title'];
  readonly run: (input: ActionInput, ctx: PluginContext) => Promise<string | void>;
};

type HookEntry = PluginPoints['hooks'][number];

export type HookEvent<At extends HookPoint = HookPoint> = Extract<HookInput, { readonly at: At }>;

export type Hook<At extends HookPoint = HookPoint> = {
  readonly at: At;
  readonly match?: HookEntry['match'];
  readonly onFailure?: HookEntry['onFailure'];
  readonly timeoutMs?: HookEntry['timeoutMs'];
  readonly run: (event: HookEvent<At>, ctx: PluginContext) => Promise<HookVerdicts[At] | void>;
};

type AnyHook = { readonly [At in HookPoint]: Hook<At> }[HookPoint];

export type EndingHandler = (ending: EndingInput, ctx: PluginContext) => Promise<void>;

export type AskedHandler = (asked: AskedInput, ctx: PluginContext) => Promise<void | AskedLeft>;

export type NotificationHandler = (answer: NotificationInput, ctx: PluginContext) => Promise<void>;

type ViewPoint = PluginPoints['views'][number];

export type View = { readonly entry: ViewPoint['entry']; readonly live?: ViewPoint['live'] };

export type HandledPoint = 'tools' | 'schedule' | 'beforeBuild' | 'on' | 'notify' | 'actions' | 'hooks' | 'views';

export type PluginData = { readonly [Point in Exclude<keyof PluginPoints, HandledPoint>]?: PluginPoints[Point] };

export type PluginDefinition = PluginData & {
  readonly id: PluginEnvelope['id'];
  readonly title: PluginEnvelope['title'];
  readonly description?: PluginEnvelope['description'];
  readonly resident?: NonNullable<PluginEnvelope['process']>['resident'];
  readonly options?: PluginEnvelope['options'];
  readonly mcpServers?: PluginEnvelope['mcpServers'];
  readonly tools?: Readonly<Record<string, Tool<any>>>;
  readonly resources?: Readonly<Record<string, Resource>>;
  readonly views?: Readonly<Record<string, View>>;
  readonly schedules?: Readonly<Record<string, Schedule>>;
  readonly beforeBuild?: Readonly<Record<string, BuildStep>>;
  readonly actions?: Readonly<Record<string, Action>>;
  readonly hooks?: Readonly<Record<string, AnyHook>>;
  readonly onThreadEnded?: EndingHandler;
  readonly onThreadAsked?: AskedHandler;
  readonly onNotification?: NotificationHandler;
};

type Unknown<Definition> = { readonly [Field in Exclude<keyof Definition, keyof PluginDefinition>]: never };

export const definePlugin = <const Definition extends PluginDefinition>(definition: Definition & Unknown<Definition>): Definition =>
  definition;

export const tool = <S extends InputSchema | undefined = undefined, A extends ToolAudience = ToolAudience, R = unknown>(
  declared: Tool<S, A, R>,
): NoInfer<Tool<S, A, R>> => declared;

export const resource = (declared: Resource): Resource => declared;

export const view = (entry: string, options: { readonly live?: true } = {}): View => ({ entry: entry.replace(/^\.\//u, ''), ...options });

export const schedule = (declared: Schedule): Schedule => declared;

export const beforeBuild = (declared: BuildStep): BuildStep => declared;

export const action = (declared: Action): Action => declared;

export const hook = <const At extends HookPoint>(declared: Hook<At>): Hook<At> => declared;

export const onThreadEnded = (handler: EndingHandler): EndingHandler => handler;

export const onThreadAsked = (handler: AskedHandler): AskedHandler => handler;

export const leave = (): AskedLeft => ASKED_LEFT;

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
