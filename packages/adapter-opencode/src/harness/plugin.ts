import { resolve } from 'node:path';
import type { Plugin } from '@opencode/plugin';

type Entry = { readonly hooks: readonly { readonly command: string }[] };
type State = {
  readonly root: string;
  readonly cwd: string;
  readonly context: string[];
  readonly inputs: Map<string, string>;
  ready: PromiseWithResolvers<void>;
  turn: string | null;
  answer: string;
};

export default {
  id: 'tagma-terminal',
  async setup(ctx) {
    const document: unknown = await Bun.file(new URL('../../tagma-hooks.json', import.meta.url)).json();
    if (
      typeof document !== 'object' ||
      document === null ||
      !('hooks' in document) ||
      typeof document.hooks !== 'object' ||
      document.hooks === null
    )
      throw new Error('Tagma terminal hooks have no command table');
    const commands = new Map<string, string[]>();
    for (const [event, entries] of Object.entries(document.hooks)) {
      if (!Array.isArray(entries)) throw new Error(`Tagma hook ${event} is not an array`);
      const found: string[] = [];
      for (const entry of entries as readonly Entry[]) {
        if (!Array.isArray(entry.hooks)) throw new Error(`Tagma hook ${event} has no handlers`);
        for (const handler of entry.hooks) {
          if (typeof handler.command !== 'string') throw new Error(`Tagma hook ${event} has no command`);
          found.push(handler.command);
        }
      }
      commands.set(event, found);
    }
    const sessions = new Map<string, Promise<State>>();
    const observed = new Set<string>();
    const controller = new AbortController();
    const call = async (event: string, sessionID: string, state: State, fields: Record<string, unknown> = {}): Promise<string[]> => {
      const output: string[] = [];
      for (const command of commands.get(event) ?? []) {
        const argv =
          process.platform === 'win32' ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', command] : ['/bin/sh', '-c', command];
        const child = Bun.spawn(argv, {
          cwd: state.cwd,
          env: { ...process.env, OPENCODE_SESSION_ID: state.root },
          stdin: new TextEncoder().encode(
            JSON.stringify({
              hook_event_name: event,
              session_id: state.root,
              agent_id: state.root === sessionID ? undefined : sessionID,
              prompt_id: state.turn,
              cwd: state.cwd,
              ...fields,
            }),
          ),
          stdout: 'pipe',
          stderr: 'pipe',
          signal: controller.signal,
        });
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0) throw new Error(`Tagma ${event} hook exited ${code}: ${stderr.trim()}`);
        if (stdout.trim().length > 0) output.push(stdout.trim());
      }
      return output;
    };
    const stateOf = (sessionID: Parameters<typeof ctx.session.get>[0]['sessionID']): Promise<State> => {
      const standing = sessions.get(sessionID);
      if (standing !== undefined) return standing;
      const opening = (async (): Promise<State> => {
        const session = await ctx.session.get({ sessionID });
        const parent = session.parentID === undefined ? null : await stateOf(session.parentID);
        const state: State = {
          root: parent?.root ?? sessionID,
          cwd: resolve(session.location.directory, session.subpath ?? '.'),
          context: [...(parent?.context ?? [])],
          inputs: new Map(),
          ready: Promise.withResolvers<void>(),
          turn: null,
          answer: '',
        };
        state.context.push(...(await call('SessionStart', sessionID, state)));
        return state;
      })();
      sessions.set(sessionID, opening);
      return opening;
    };
    const remember = (state: State, output: readonly string[]): void => {
      for (const text of output) {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || !('hookSpecificOutput' in parsed))
          throw new Error('Tagma tool hook returned no hook-specific output');
        const value = parsed.hookSpecificOutput;
        if (typeof value !== 'object' || value === null || !('additionalContext' in value) || typeof value.additionalContext !== 'string')
          throw new Error('Tagma tool hook returned invalid context');
        state.context.push(value.additionalContext);
      }
    };
    await ctx.session.hook('prompt', async (event) => {
      observed.add(event.sessionID);
      const state = await stateOf(event.sessionID);
      state.inputs.set(event.messageID, event.prompt.text);
    });
    await ctx.session.hook('context', async (event) => {
      observed.add(event.sessionID);
      const state = await stateOf(event.sessionID);
      for (const text of state.context) event.system.push({ type: 'text', text });
    });
    await ctx.tool.hook('execute.before', async (event) => {
      observed.add(event.sessionID);
      const state = await stateOf(event.sessionID);
      if (state.turn === null && state.inputs.size > 0) await Promise.race([state.ready.promise, events]);
      const fields = { tool_name: event.tool, tool_use_id: event.id, tool_input: event.input };
      for (const text of await call('PermissionRequest', event.sessionID, state, fields)) {
        const answer: unknown = JSON.parse(text);
        if (typeof answer !== 'object' || answer === null || !('decision' in answer))
          throw new Error('Tagma returned an invalid permission answer');
        if (answer.decision === 'deny')
          throw new Error('reason' in answer && typeof answer.reason === 'string' ? answer.reason : 'Tagma denied this call');
        if (answer.decision !== 'approve') throw new Error('Tagma returned an unknown permission decision');
      }
      remember(state, await call('PreToolUse', event.sessionID, state, fields));
    });
    await ctx.tool.hook('execute.after', async (event) => {
      const state = await stateOf(event.sessionID);
      const content = event.status === 'completed' ? event.result.content : event.error.message;
      const output =
        typeof content === 'string'
          ? content
          : (content ?? [])
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n');
      remember(
        state,
        await call(event.status === 'completed' ? 'PostToolUse' : 'PostToolUseFailure', event.sessionID, state, {
          tool_name: event.tool,
          tool_use_id: event.id,
          tool_input: event.input,
          tool_response: output,
        }),
      );
    });
    const events = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (!('sessionID' in event.data) || !observed.has(event.data.sessionID)) continue;
        if (event.type === 'session.inbox.delivered') {
          const state = await stateOf(event.data.sessionID);
          state.turn ??= event.data.inboxID;
          await call('UserPromptSubmit', event.data.sessionID, state, { prompt: state.inputs.get(event.data.inboxID) ?? '' });
          state.inputs.delete(event.data.inboxID);
          state.ready.resolve();
        } else if (event.type === 'session.inbox.cancelled') {
          (await stateOf(event.data.sessionID)).inputs.delete(event.data.inboxID);
        } else if (event.type === 'session.text.ended') {
          const state = await stateOf(event.data.sessionID);
          state.answer += event.data.text;
        } else if (
          event.type === 'session.execution.succeeded' ||
          event.type === 'session.execution.failed' ||
          event.type === 'session.execution.interrupted'
        ) {
          const state = await stateOf(event.data.sessionID);
          const status =
            event.type === 'session.execution.interrupted' ? 'aborted' : event.type === 'session.execution.failed' ? 'error' : 'completed';
          const error = event.type === 'session.execution.failed' ? event.data.error.message : undefined;
          await call('Stop', event.data.sessionID, state, { last_assistant_message: state.answer, status, error });
          state.turn = null;
          state.answer = '';
          state.ready = Promise.withResolvers<void>();
        } else if (event.type === 'session.deleted') {
          observed.delete(event.data.sessionID);
          sessions.delete(event.data.sessionID);
        }
      }
      if (!controller.signal.aborted) throw new Error('The OpenCode terminal event stream ended');
    })();
    void events.catch((cause: unknown) => {
      if (!controller.signal.aborted) console.error('Tagma terminal event stream failed:', cause);
    });
    return () => controller.abort();
  },
} satisfies Plugin.Plugin;
