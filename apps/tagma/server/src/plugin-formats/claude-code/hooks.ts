import { Duration, Effect, Fiber, Schema, type Scope, Stream } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import type {
  PluginHook,
  PluginHookAnswer,
  PluginHookCall,
  PluginHookSession,
  PluginIgnored,
} from '../../plugins/contract/service/format.js';
import type { PluginHookPoint } from '../../plugins/contract/wire/rows.js';
import { entryOf, jsonOf, textOf } from '../../plugins/contract/service/reading.js';
import { declaredPath, type Manifest } from './manifest.js';
import { claudeInput, claudeTool, tagmaInput, type ToolNaming } from './tools.js';
import { optionEnvironment, pluginEnvironment, substituted } from './variables.js';

const EVENTS: Readonly<Record<string, PluginHookPoint>> = {
  PreToolUse: 'beforeTool',
  PostToolUse: 'afterTool',
  UserPromptSubmit: 'beforeStep',
  Stop: 'beforeClose',
  SessionStart: 'threadStarted',
  SessionEnd: 'threadEnded',
};

const Handler = Schema.Struct({
  type: Schema.String,
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  timeout: Schema.optional(Schema.Finite),
  if: Schema.optional(Schema.String),
  async: Schema.optional(Schema.Boolean),
  onFailure: Schema.optional(Schema.String),
});

const Group = Schema.Struct({ matcher: Schema.optional(Schema.String), hooks: Schema.Array(Schema.Unknown) });

const decodeHandler = Schema.decodeUnknownEffect(Handler);
const decodeGroup = Schema.decodeUnknownEffect(Group);

const Output = Schema.Struct({
  continue: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(Schema.String),
  decision: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  hookSpecificOutput: Schema.optional(
    Schema.Struct({
      permissionDecision: Schema.optional(Schema.String),
      permissionDecisionReason: Schema.optional(Schema.String),
      updatedInput: Schema.optional(Schema.Unknown),
      additionalContext: Schema.optional(Schema.String),
    }),
  ),
});

const decodeOutput = Schema.decodeUnknownOption(Output);

const LIST = /^[A-Za-z0-9_ ,|-]*$/u;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const matcherOf = (matcher: string | undefined): ((subject: string) => boolean) => {
  if (matcher === undefined || matcher === '' || matcher === '*') return () => true;
  if (LIST.test(matcher)) {
    const names = new Set(
      matcher
        .split(/[|,]/u)
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    );
    return (subject) => names.has(subject);
  }
  try {
    const pattern = new RegExp(matcher, 'u');
    return (subject) => pattern.test(subject);
  } catch {
    return () => false;
  }
};

const ENDINGS: ReadonlySet<string> = new Set(['clear', 'resume', 'logout', 'prompt_input_exit', 'other']);

const endingOf = (reason: string): string => (ENDINGS.has(reason) ? reason : 'other');

const subjectOf = (plugin: ToolNaming, call: PluginHookCall): string | null => {
  switch (call.point) {
    case 'beforeTool':
    case 'afterTool':
      return claudeTool(plugin, call.tool);
    case 'threadStarted':
      return call.resumed ? 'resume' : 'startup';
    case 'threadEnded':
      return endingOf(call.reason);
    default:
      return null;
  }
};

const inputOf = (plugin: ToolNaming, event: string, call: PluginHookCall, session: PluginHookSession) => {
  const common = { session_id: session.thread, transcript_path: '', cwd: session.cwd, permission_mode: 'default', hook_event_name: event };
  switch (call.point) {
    case 'beforeTool':
      return {
        ...common,
        tool_name: claudeTool(plugin, call.tool),
        tool_input: claudeInput(call.tool, call.input),
        tool_use_id: call.callId,
      };
    case 'afterTool':
      return {
        ...common,
        tool_name: claudeTool(plugin, call.tool),
        tool_input: claudeInput(call.tool, call.input),
        tool_response: call.output,
        tool_use_id: call.callId,
      };
    case 'beforeStep':
      return { ...common, prompt: call.text };
    case 'beforeClose':
      return { ...common, stop_hook_active: call.continued, last_assistant_message: call.answer ?? '' };
    case 'threadStarted':
      return { ...common, source: call.resumed ? 'resume' : 'startup' };
    case 'threadEnded':
      return { ...common, reason: endingOf(call.reason) };
  }
};

const timeoutOf = (event: string, declared: number | undefined): Duration.Duration =>
  declared !== undefined && declared > 0
    ? Duration.seconds(event === 'SessionEnd' ? Math.min(declared, 60) : declared)
    : event === 'UserPromptSubmit'
      ? Duration.seconds(30)
      : event === 'SessionEnd'
        ? Duration.millis(1_500)
        : Duration.seconds(600);

const text = <E>(bytes: Stream.Stream<Uint8Array, E>) => Stream.mkString(Stream.decodeText(bytes));

type Ran = { readonly status: number; readonly stdout: string; readonly stderr: string };

const answerOf = (plugin: ToolNaming, call: PluginHookCall, ran: Ran): PluginHookAnswer => {
  const said = ran.stderr.trim();
  if (ran.status === 2) {
    switch (call.point) {
      case 'beforeTool':
        return { deny: said || 'a hook blocked this call' };
      case 'afterTool':
        return { context: said };
      case 'beforeStep':
      case 'beforeClose':
        return { block: said || 'a hook blocked this' };
      default:
        return { failure: said || 'exited 2' };
    }
  }
  if (ran.status !== 0) return { failure: said.split('\n')[0] || `exited ${ran.status}` };
  const printed = ran.stdout.trim();
  const json = printed.startsWith('{') ? jsonOf(printed) : null;
  const output = json !== null && 'value' in json ? decodeOutput(json.value) : null;
  if (output === null || output._tag === 'None') {
    return printed.length > 0 && (call.point === 'beforeStep' || call.point === 'threadStarted') ? { context: printed } : {};
  }
  const { decision, reason, hookSpecificOutput: specific } = output.value;
  const context = specific?.additionalContext;
  const halted = output.value.continue === false;
  const stopped = output.value.stopReason || 'a hook asked to stop';
  switch (call.point) {
    case 'beforeTool':
      if (halted) return { deny: stopped };
      return {
        deny:
          specific?.permissionDecision === 'deny'
            ? specific.permissionDecisionReason || 'a hook denied this call'
            : specific?.permissionDecision === undefined && decision === 'block'
              ? reason || 'a hook denied this call'
              : undefined,
        input: specific?.updatedInput === undefined ? undefined : tagmaInput(call.tool, specific.updatedInput),
        context,
      };
    case 'afterTool':
      return {
        context:
          [halted ? stopped : undefined, decision === 'block' ? reason : undefined, context]
            .filter((part) => part !== undefined)
            .join('\n') || undefined,
      };
    case 'beforeStep':
      if (halted) return { block: stopped, context };
      return { block: decision === 'block' ? reason || 'a hook blocked this message' : undefined, context };
    case 'beforeClose':
      if (halted) return {};
      return { block: decision === 'block' ? reason || 'a hook asked to continue' : context };
    case 'threadStarted':
      return { context };
    case 'threadEnded':
      return {};
  }
};

const failedBlocking = (call: PluginHookCall, answer: PluginHookAnswer): PluginHookAnswer => {
  if (answer.failure === undefined) return answer;
  const reason = `a hook that blocks on failure failed: ${answer.failure}`;
  switch (call.point) {
    case 'beforeTool':
      return { deny: reason };
    case 'beforeStep':
    case 'beforeClose':
      return { block: reason };
    default:
      return answer;
  }
};

type Spawn = {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: Uint8Array;
};

const spawned = Effect.fnUntraced(function* (
  spawn: Spawn,
): Effect.fn.Return<Ran, PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> {
  const handle = yield* ChildProcess.make(spawn.program, spawn.args, {
    cwd: spawn.cwd,
    env: spawn.env,
    extendEnv: true,
    stdin: 'pipe',
    forceKillAfter: '1 second',
  });
  yield* Effect.forkScoped(Stream.run(Stream.make(spawn.stdin), handle.stdin));
  const stdout = yield* Effect.forkScoped(text(handle.stdout));
  const stderr = yield* Effect.forkScoped(text(handle.stderr));
  const status = yield* handle.exitCode;
  return { status: Number(status), stdout: yield* Fiber.join(stdout), stderr: yield* Fiber.join(stderr) };
});

const runner =
  (plugin: ToolNaming, event: string, handler: typeof Handler.Type): PluginHook['run'] =>
  (call, session, place) => {
    const command = substituted(handler.command ?? '', place);
    const args = handler.args?.map((arg) => substituted(arg, place));
    const limit = timeoutOf(event, handler.timeout);
    return Effect.scoped(
      spawned({
        program: args === undefined ? 'bash' : command,
        args: args ?? ['-c', command],
        cwd: session.cwd,
        env: { CLAUDE_PROJECT_DIR: place.project, ...pluginEnvironment(place), ...optionEnvironment(place) },
        stdin: new TextEncoder().encode(JSON.stringify(inputOf(plugin, event, call, session))),
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: limit,
        orElse: () => Effect.succeed<Ran>({ status: -1, stdout: '', stderr: `timed out after ${Duration.format(limit)}` }),
      }),
      Effect.map((ran) => answerOf(plugin, call, ran)),
      Effect.catchTag('PlatformError', (failure) => Effect.succeed<PluginHookAnswer>({ failure: `could not start: ${failure.message}` })),
      Effect.map((answer) => (handler.onFailure === 'block' ? failedBlocking(call, answer) : answer)),
      Effect.withSpan('claudeCode.hook', { attributes: { event } }),
    );
  };

const eventMap = Effect.fnUntraced(function* (
  plugin: ToolNaming,
  label: string,
  events: Readonly<Record<string, unknown>>,
  hooks: PluginHook[],
  ignored: PluginIgnored[],
) {
  for (const [event, groups] of Object.entries(events)) {
    const point = EVENTS[event];
    if (point === undefined) {
      ignored.push({ component: 'hook', name: event, reason: 'Tagma runs no hook on this event' });
      continue;
    }
    if (!Array.isArray(groups)) {
      ignored.push({ component: 'hook', name: `${event} in ${label}`, reason: 'its matcher groups are not a list' });
      continue;
    }
    for (const raw of groups) {
      const group = yield* decodeGroup(raw).pipe(Effect.option);
      if (group._tag === 'None') {
        ignored.push({ component: 'hook', name: `${event} in ${label}`, reason: 'a matcher group without a hooks list' });
        continue;
      }
      const matches = matcherOf(group.value.matcher);
      for (const entry of group.value.hooks) {
        const handler = yield* decodeHandler(entry).pipe(Effect.option);
        if (handler._tag === 'None') {
          ignored.push({ component: 'hook', name: event, reason: 'a handler without a type' });
          continue;
        }
        const { type, command } = handler.value;
        if (type !== 'command') {
          ignored.push({ component: 'hook', name: `${event} ${type}`, reason: 'Tagma runs command handlers only' });
          continue;
        }
        if (command === undefined || command.length === 0) {
          ignored.push({ component: 'hook', name: event, reason: 'a command handler without a command' });
          continue;
        }
        if (handler.value.args === undefined && command.includes('${user_config.')) {
          ignored.push({
            component: 'hook',
            name: `${event} ${command}`,
            reason: 'a shell command takes option values from CLAUDE_PLUGIN_OPTION_<KEY>, never ${user_config.KEY}',
          });
          continue;
        }
        if (handler.value.async === true) {
          ignored.push({ component: 'hook', name: `${event} ${command}`, reason: 'Tagma does not run hooks in the background' });
          continue;
        }
        if (handler.value.if !== undefined) {
          ignored.push({
            component: 'hook',
            name: `${event} ${command}`,
            reason: 'Tagma does not read the if permission rule a handler carries',
          });
          continue;
        }
        hooks.push({
          point,
          label: `${event}${group.value.matcher === undefined || group.value.matcher === '' ? '' : ` ${group.value.matcher}`}: ${command}`,
          matches: (call) => {
            if (call.point !== point) return false;
            const subject = subjectOf(plugin, call);
            return subject === null || matches(subject);
          },
          run: runner(plugin, event, handler.value),
        });
      }
    }
  }
});

const hooksFile = Effect.fnUntraced(function* (
  plugin: ToolNaming,
  path: string,
  label: string,
  hooks: PluginHook[],
  ignored: PluginIgnored[],
) {
  const raw = jsonOf(yield* textOf(path));
  if ('reason' in raw) {
    ignored.push({ component: 'hooks', name: label, reason: `not JSON: ${raw.reason}` });
    return;
  }
  if (!isObject(raw.value) || !isObject(raw.value['hooks'])) {
    ignored.push({ component: 'hooks', name: label, reason: 'a hooks file wraps its events in a top-level "hooks" object' });
    return;
  }
  yield* eventMap(plugin, label, raw.value['hooks'], hooks, ignored);
});

export const hooksOf = Effect.fnUntraced(function* (
  root: string,
  plugin: ToolNaming,
  manifest: Manifest | null,
  ignored: PluginIgnored[],
  replacing: Readonly<Record<string, unknown>> | null,
) {
  const hooks: PluginHook[] = [];
  const standard = yield* entryOf(root, 'hooks/hooks.json');
  if (standard.kind === 'file') yield* hooksFile(plugin, standard.path, 'hooks/hooks.json', hooks, ignored);
  const shapes = manifest?.hooks === undefined ? [] : Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
  for (const shape of shapes) {
    if (typeof shape === 'string') {
      const entry = yield* declaredPath(root, 'hooks', shape, ignored);
      if (entry?.kind === 'file') yield* hooksFile(plugin, entry.path, shape, hooks, ignored);
      else if (entry !== null) ignored.push({ component: 'hooks', name: shape, reason: 'not a JSON file' });
    } else if (isObject(shape)) yield* eventMap(plugin, 'plugin.json', shape, hooks, ignored);
    else ignored.push({ component: 'hooks', name: null, reason: 'a hooks entry is neither a path nor an event map' });
  }
  if (replacing === null) return hooks;
  const replaced = new Set(Object.keys(replacing).flatMap((event) => EVENTS[event] ?? []));
  const kept = hooks.filter((hook) => !replaced.has(hook.point));
  yield* eventMap(plugin, 'its marketplace entry', replacing, kept, ignored);
  return kept;
});
