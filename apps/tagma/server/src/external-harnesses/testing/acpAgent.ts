import { appendFileSync, existsSync, readFileSync, rmSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SessionConfigOption } from '@runlith/acp/updates';

if (process.argv.includes('--version')) {
  process.stdout.write('acp-agent fixture\n');
  process.exit(0);
}

const at = process.argv.indexOf('--report');
const report = at < 0 ? undefined : process.argv[at + 1];
if (report === undefined) {
  process.stderr.write('acpAgent needs --report <path>\n');
  process.exit(2);
}

const modeAt = process.argv.indexOf('--mode');
const mode = modeAt < 0 ? 'plain' : process.argv[modeAt + 1];
process.stderr.write('agent booted\n');

type Message = {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
};

const send = (message: Record<string, unknown>): void => {
  const line = `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`;
  appendFileSync(`${report}.out`, line);
  process.stdout.write(line);
};

const update = (sessionId: string, body: Record<string, unknown>): void =>
  send({ method: 'session/update', params: { sessionId, update: body } });

type Announced = { readonly toolCallId: string; readonly name: string; readonly input: unknown };

const announce = (sessionId: string, call: Announced): void => {
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: call.toolCallId,
    title: call.name,
    name: call.name,
    kind: 'other',
    status: 'pending',
    rawInput: call.input,
    _meta: { 'tagma/executes': true },
  });
  send({ method: '_tagma/said', params: { sessionId, messageId: `said-${call.toolCallId}`, toolCallIds: [call.toolCallId] } });
};

let prompt: { readonly id: string | number; readonly sessionId: string; readonly turn: unknown; readonly unsent: boolean } | null = null;
let asking: string | null = null;
const doubled = { pending: new Set<string>(), chose: [] as string[] };
let compacting: string | number | null = null;
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
type ConfigValues = { model: string; effort: string; thinking: string; [id: string]: string };
const current: ConfigValues = {
  model: existsSync(`${report}.model`) ? readFileSync(`${report}.model`, 'utf8').trim() : 'claude-opus-5-5',
  effort: 'medium',
  thinking: 'omitted',
};
let configured: readonly SessionConfigOption[] | null = null;
if (existsSync(`${report}.config`)) {
  const { Schema } = await import('effect');
  const { SessionConfigOption } = await import('@runlith/acp/updates');
  configured = Schema.decodeUnknownSync(Schema.Array(SessionConfigOption))(JSON.parse(readFileSync(`${report}.config`, 'utf8')));
}
for (const option of configured ?? []) if (option.type === 'select') current[option.id] = option.currentValue;
const served = (): readonly SessionConfigOption[] =>
  configured === null
    ? [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          currentValue: current.model,
          options: ['claude-opus-5-5', 'claude-sonnet-5-5'].map((value) => ({ value, name: value })),
        },
        {
          id: 'effort',
          name: 'Effort',
          type: 'select',
          currentValue: current.effort,
          options: EFFORTS.map((value) => ({ value, name: value })),
        },
        {
          id: 'thinking',
          name: 'Thinking summary',
          type: 'select',
          currentValue: current.thinking,
          options: ['summarized', 'omitted'].map((value) => ({ value, name: value })),
        },
      ]
    : configured.map((option) =>
        option.type === 'select' ? { ...option, currentValue: current[option.id] ?? option.currentValue } : option,
      );
const usage = { totalTokens: 3, inputTokens: 2, outputTokens: 1 };
const measured = {
  message: 'msg-measured',
  sentAt: '2026-10-07T12:00:00.000Z',
  input: 910,
  cacheRead: 0,
  cacheWrite: 900,
  output: 50,
  reasoning: 20,
  ttlSeconds: 3_600,
};
const RATE_LIMITED = {
  stage: 'claude-code.turn',
  type: 'RateLimit',
  httpStatus: 429,
  retryable: true,
  modelStarted: false,
  rateLimit: { retryAfterMs: 720_000 },
  reason: { family: 'rate-limit', status: 429 },
};
const TAGMA = [
  '_tagma/steer',
  '_tagma/withdraw',
  '_tagma/compact',
  '_tagma/fork',
  '_tagma/rewind',
  '_tagma/aside',
  '_tagma/compacted',
  '_tagma/compacting',
  '_tagma/said',
  '_tagma/retrying',
];

const held: Array<() => void> = [];
const steering = new Map<string, { readonly id: string | number; readonly words: string }>();
let stepping: { readonly id: string | number; readonly sessionId: string } | null = null;
let late = false;
let trailing = false;
let owed = false;
let lingering: boolean | 'held' = false;
let refusals = 0;
const WITHDRAWN = { code: -32800, message: 'the words were taken back before the agent read them' };
const SUMMARY = { preTokens: 900, postTokens: 90, summary: 'the compacted summary' };
const stepped = (): void => {
  if (stepping === null) return;
  const { id, sessionId } = stepping;
  stepping = null;
  send({ method: '_tagma/compacting', params: { sessionId, running: true } });
  send({ method: '_tagma/compacted', params: { sessionId, trigger: 'auto', ...SUMMARY } });
  send({ id, result: SUMMARY });
};
const unstepped = (code: number, message: string): void => {
  if (stepping === null) return;
  send({ id: stepping.id, error: { code, message } });
  stepping = null;
};
const limitedHere = (): boolean =>
  !existsSync(`${report}.limited`) || readFileSync(`${report}.limited`, 'utf8').trim() === process.env.CLAUDE_CONFIG_DIR;
const later = (answer: () => void): void => {
  if (existsSync(`${report}.hold`)) held.push(answer);
  else answer();
};
if (mode === 'tagma') {
  watch(dirname(report), () => {
    if (existsSync(`${report}.step`)) {
      rmSync(`${report}.step`, { force: true });
      for (const { id } of steering.values()) send({ id, result: { outcome: 'injected' } });
      steering.clear();
      stepped();
    }
    if (prompt !== null && existsSync(`${report}.call`)) {
      rmSync(`${report}.call`, { force: true });
      update(prompt.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 'hosted-call',
        title: 'Read the floor',
        kind: 'read',
        status: 'in_progress',
        rawInput: { path: 'floor' },
        _meta: { 'tagma/executes': true },
      });
    }
    if (prompt !== null && existsSync(`${report}.vendor`)) {
      rmSync(`${report}.vendor`, { force: true });
      update(prompt.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 'vendor-call',
        title: 'Fetch the page',
        kind: 'fetch',
        status: 'in_progress',
        rawInput: { url: 'https://example.com' },
      });
    }
    if (prompt !== null && existsSync(`${report}.refused`)) {
      rmSync(`${report}.refused`, { force: true });
      const toolCallId = `refused-call-${(refusals += 1)}`;
      update(prompt.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId,
        title: 'read_output',
        name: 'read_output',
        kind: 'other',
        status: 'pending',
        rawInput: { id: 'c-1' },
        _meta: { 'tagma/executes': true },
      });
      send({ method: '_tagma/said', params: { sessionId: prompt.sessionId, messageId: `said-${toolCallId}`, toolCallIds: [toolCallId] } });
      update(prompt.sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'failed',
        content: [{ type: 'content', content: { type: 'text', text: 'No such tool available: mcp__tagma__read_output' } }],
        _meta: { 'tagma/executes': false },
      });
    }
    if (prompt !== null && existsSync(`${report}.search`)) {
      const query = readFileSync(`${report}.search`, 'utf8').trim();
      rmSync(`${report}.search`, { force: true });
      announce(prompt.sessionId, { toolCallId: 'search-call', name: 'tool_search', input: { query } });
    }
    if (prompt !== null && existsSync(`${report}.announce`)) {
      const call = JSON.parse(readFileSync(`${report}.announce`, 'utf8')) as Announced;
      rmSync(`${report}.announce`, { force: true });
      announce(prompt.sessionId, call);
    }
    if (prompt !== null && existsSync(`${report}.said`)) {
      rmSync(`${report}.said`, { force: true });
      send({ method: '_tagma/said', params: { sessionId: prompt.sessionId, messageId: 'said-1', toolCallIds: ['hosted-call'] } });
    }
    if (!existsSync(`${report}.release`)) return;
    for (let answer = held.shift(); answer !== undefined; answer = held.shift()) answer();
  });
}

const textOf = (params: Record<string, unknown> | undefined, key = 'prompt'): string =>
  ((params?.[key] as readonly { readonly text?: string }[] | undefined) ?? []).map((block) => block.text ?? '').join('\n');

const said = (params: Record<string, unknown> | undefined, key: string): string => {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
};

const finish = (stopReason: string): void => {
  if (prompt === null) return;
  unstepped(-32010, 'the turn ended before the agent reached another step');
  const meta =
    mode === 'tagma' && typeof prompt.turn === 'string'
      ? { _meta: { 'tagma/turn': { prompt: prompt.turn, last: `last-${prompt.turn}` }, 'tagma/opened': !prompt.unsent } }
      : {};
  send({ id: prompt.id, result: { stopReason, usage, ...meta } });
  prompt = null;
};

const extended = (message: Message): void => {
  const id = message.id!;
  switch (message.method) {
    case '_tagma/steer': {
      const words = textOf(message.params);
      if (/DROP|UNHELD/.test(words)) later(() => send({ id, error: { code: words.includes('DROP') ? -32603 : -32002, message: 'no' } }));
      else if (words.includes('RETURN') || prompt === null) later(() => send({ id, result: { outcome: 'promptRequired' } }));
      else steering.set(said(message.params, 'input') || String(id), { id, words });
      return;
    }
    case '_tagma/withdraw': {
      const input = said(message.params, 'input');
      const steered = steering.get(input);
      if (steered?.words.includes('STUCK')) {
        send({ id, error: { code: -32603, message: 'the words could not be taken back' } });
        return;
      }
      steering.delete(input);
      if (steered !== undefined) send({ id: steered.id, error: WITHDRAWN });
      send({ id, result: { withdrawn: steered !== undefined } });
      return;
    }
    case '_tagma/compact': {
      const instructions = said(message.params, 'instructions');
      if (message.params?.at === 'step') {
        if (prompt !== null && instructions.includes('UNSTEPPED'))
          send({ id, error: { code: -32010, message: 'the agent could not arm compaction at the next step' } });
        else if (prompt !== null) {
          stepping = { id, sessionId: said(message.params, 'sessionId') };
          if (instructions.includes('HOLD')) send({ method: '_tagma/compacting', params: { sessionId: prompt.sessionId, running: true } });
        } else send({ id, error: { code: -32010, message: 'no turn is running, so no step will come' } });
      } else if (instructions.includes('CANCEL')) compacting = id;
      else if (instructions.includes('GARBLE')) send({ method: '_tagma/said', params: { sessionId: said(message.params, 'sessionId') } });
      else if (instructions.includes('FAIL')) send({ id, error: { code: -32603, message: 'summary refused', data: { usage } } });
      else {
        later(() => {
          send({ method: '_tagma/compacted', params: { sessionId: said(message.params, 'sessionId'), trigger: 'manual', ...SUMMARY } });
          send({ id, result: { ...SUMMARY, usage } });
        });
      }
      return;
    }
    case '_tagma/fork':
      later(() => send({ id, result: { sessionId: 'sess-fork', configOptions: served() } }));
      return;
    case '_tagma/rewind':
      later(() =>
        send(
          existsSync(`${report}.unrewound`)
            ? { id, error: { code: -32602, message: 'the session holds no such turn' } }
            : { id, result: { sessionId: 'sess-rewound', configOptions: served() } },
        ),
      );
      return;
    case '_tagma/aside': {
      const question = said(message.params, 'question');
      if (question.includes('HOLD')) return;
      send(
        question.includes('FAIL')
          ? { id, error: { code: -32603, message: 'side question refused' } }
          : { id, result: { text: question.startsWith('Name this conversation') ? 'TITLE: Held turn' : `aside: ${question}`, usage } },
      );
      return;
    }
  }
};

const handle = (message: Message): void => {
  if (message.method === undefined) {
    if (prompt !== null && doubled.pending.delete(String(message.id))) {
      const outcome = (message.result as { readonly outcome?: { readonly outcome?: string; readonly optionId?: string } } | undefined)
        ?.outcome;
      doubled.chose.push(`${String(message.id)}:${outcome?.optionId ?? outcome?.outcome}`);
      if (doubled.pending.size > 0) return;
      update(prompt.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'answer',
        content: { type: 'text', text: `chose ${doubled.chose.sort().join(',')}` },
      });
      finish('end_turn');
      return;
    }
    if (asking !== null && message.id === asking && prompt !== null) {
      asking = null;
      const outcome = (message.result as { readonly outcome?: { readonly outcome?: string; readonly optionId?: string } } | undefined)
        ?.outcome;
      if (mode === 'live') {
        update(prompt.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'empty', content: { type: 'text', text: '   ' } });
        update(prompt.sessionId, {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'link',
          content: { type: 'resource_link', name: 'floor', uri: 'file:///floor' },
        });
      }
      update(prompt.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'answer',
        content: { type: 'text', text: `chose ${outcome?.optionId ?? outcome?.outcome}` },
      });
      if (mode !== 'live') finish('end_turn');
    }
    return;
  }
  if (mode === 'tagma' && message.method.startsWith('_tagma/')) {
    extended(message);
    return;
  }
  switch (message.method) {
    case 'initialize':
      if (existsSync(join(dirname(report), 'opening.hold'))) return;
      send({
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities:
            mode === 'tagma'
              ? {
                  loadSession: true,
                  sessionCapabilities: { resume: {}, close: {} },
                  promptCapabilities: { image: existsSync(`${report}.pictures`) },
                  _meta: { 'tagma/extensions': TAGMA },
                }
              : { loadSession: true, promptCapabilities: { image: mode === 'pictures' } },
          authMethods: [],
        },
      });
      return;
    case 'session/new':
      if (mode === 'auth') send({ id: message.id, error: { code: -32000, message: 'Authentication required' } });
      else if (mode === 'internal-error') send({ id: message.id, error: { code: -32603, message: 'session storage unavailable' } });
      else
        send({
          id: message.id,
          result: {
            sessionId: 'sess-1',
            ...(mode === 'tagma' ? { configOptions: served() } : {}),
          },
        });
      return;
    case 'session/load':
    case 'session/resume':
      if (mode === 'load-error') send({ id: message.id, error: { code: -32603, message: 'session storage unavailable' } });
      else if (mode === 'load-missing') send({ id: message.id, error: { code: -32002, message: 'no conversation kept-session' } });
      else send({ id: message.id, result: mode === 'tagma' ? { configOptions: served() } : {} });
      return;
    case 'session/close':
      send({ id: message.id, result: {} });
      return;
    case 'session/set_config_option': {
      const configId = said(message.params, 'configId');
      const value = said(message.params, 'value');
      const option = served().find((option) => option.id === configId);
      const offered =
        option?.type === 'select'
          ? option.options.flatMap((entry) => ('options' in entry ? entry.options.map((value) => value.value) : [entry.value]))
          : [];
      if (!offered.includes(value)) {
        send({ id: message.id, error: { code: -32602, message: `${configId} has no ${value}` } });
        return;
      }
      current[configId] = configId === 'effort' && value === 'xhigh' ? 'high' : value;
      send({ id: message.id, result: { configOptions: served() } });
      return;
    }
    case 'session/set_mode':
      send({ id: message.id, result: {} });
      return;
    case 'session/cancel':
      if (existsSync(`${report}.deaf`)) return;
      if (lingering !== false) {
        if (lingering === true)
          held.push(() => {
            lingering = false;
            handle(message);
          });
        lingering = 'held';
        return;
      }
      if (late) finish('cancelled');
      {
        const kept = [...steering.values()].filter((steered) => steered.words.includes('SURVIVE'));
        const withdrawn = [...steering.values()].filter((steered) => !kept.includes(steered));
        steering.clear();
        later(() => {
          for (const steered of withdrawn) send({ id: steered.id, error: WITHDRAWN });
        });
        if (kept.length > 0 && prompt !== null) {
          const sessionId = prompt.sessionId;
          later(() => {
            for (const [index, steered] of kept.entries())
              send({ id: steered.id, result: { outcome: index === 0 ? 'startedNewTurn' : 'injected' } });
            update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ran the words it kept' } });
            finish('end_turn');
          });
          return;
        }
      }
      unstepped(-32800, 'the turn was cancelled before the agent compacted it');
      if (owed && prompt !== null)
        update(prompt.sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': measured } });
      if (trailing && prompt !== null) {
        update(prompt.sessionId, {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'late',
          content: { type: 'text', text: 'late words' },
        });
        update(prompt.sessionId, {
          sessionUpdate: 'tool_call',
          toolCallId: 'late-call',
          title: 'Read late.ts',
          kind: 'read',
          status: 'completed',
          rawInput: { path: 'late.ts' },
        });
        if (mode === 'tagma') {
          const sessionId = prompt.sessionId;
          send({ method: '_tagma/said', params: { sessionId, messageId: 'late', toolCallIds: ['late-call'] } });
          update(sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': measured } });
          setTimeout(() => finish('cancelled'), 50);
          return;
        }
      }
      finish('cancelled');
      if (compacting !== null) send({ id: compacting, error: { code: -32800, message: 'compaction cancelled', data: { usage } } });
      compacting = null;
      return;
    case 'session/prompt': {
      if (mode === 'refuse-prompts') {
        send({ id: message.id, error: { code: -32001, message: 'quota exhausted' } });
        return;
      }
      const sessionId = String(message.params?.sessionId);
      const meta = message.params?._meta as Record<string, unknown> | undefined;
      const text = textOf(message.params);
      prompt = { id: message.id!, sessionId, turn: meta?.['tagma/turn'], unsent: text.includes('UNSENT') };
      late = text.includes('LATE');
      trailing = text.includes('TRAIL');
      owed = mode === 'tagma' && text.includes('OWED');
      lingering = text.includes('LINGER');
      if (mode === 'tagma' && (text.includes('MEASURE') || text.includes('WARM'))) {
        const sent = text.includes('WARM') ? { ...measured, sentAt: new Date().toISOString() } : measured;
        update(sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': sent } });
      }
      const phase = (name: string) => send({ method: '$/tagma/phase', params: { sessionId, phase: name } });
      if (mode === 'tagma' && text.includes('PHASES')) {
        phase('reasoning');
        update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Weighing it.' } });
        phase('calling');
        phase('writing');
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Said.' } });
        phase('calling');
        update(sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': measured } });
        finish('end_turn');
        return;
      }
      if (mode === 'tagma' && text.includes('PONDER')) {
        phase('reasoning');
        update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Weighing it.' } });
        held.push(() => finish('end_turn'));
        return;
      }
      if (mode === 'tagma' && text.includes('SCRIBBLE')) {
        phase('tools');
        held.push(() => {
          for (const delta of ['', '{"path":"fix', 'ture.ts"', ',"offset":1}'])
            send({ method: '$/tagma/input', params: { sessionId, toolCallId: 'written-call', name: 'read', delta } });
        });
        return;
      }
      if (mode === 'tagma' && text.includes('GAUGE')) {
        held.push(() => {
          update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Measured.' } });
          update(sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': measured } });
          send({ id: message.id, result: { stopReason: 'end_turn' } });
          prompt = null;
        });
        return;
      }
      if (mode === 'tagma' && text.includes('STEPPED')) {
        const first = { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': measured } };
        update(sessionId, first);
        held.push(() => {
          update(sessionId, first);
          const next = { ...measured, message: 'msg-next', input: 1_000, cacheRead: 900, cacheWrite: 0, output: 30, reasoning: 0 };
          update(sessionId, { sessionUpdate: 'usage_update', used: 1_030, size: 200_000, _meta: { 'tagma/measured': next } });
          update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Stepped.' } });
          send({ id: message.id, result: { stopReason: 'end_turn' } });
          prompt = null;
        });
        return;
      }
      if (mode === 'tagma' && text.includes('PAUSE')) {
        send({
          method: '_tagma/retrying',
          params: {
            sessionId,
            uuid: 'pause-1',
            attempt: 1,
            of: 10,
            delayMs: 60_000,
            family: 'overloaded',
            httpStatus: 529,
            message: 'overloaded',
          },
        });
        phase('retrying');
        held.push(() => finish('end_turn'));
        return;
      }
      if (mode === 'tagma' && text.includes('RETRY')) {
        for (const delta of ['', '{"path"', ':"a'])
          send({ method: '$/tagma/input', params: { sessionId, toolCallId: 'written-call', name: 'read', delta } });
        send({
          method: '_tagma/retrying',
          params: {
            sessionId,
            uuid: 'retry-1',
            attempt: 1,
            of: 10,
            delayMs: 500,
            family: 'overloaded',
            httpStatus: 529,
            message: 'overloaded',
          },
        });
      }
      if (mode === 'tagma' && text.includes('THINK'))
        update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
      if (mode === 'tagma' && text.includes('HOLD')) {
        held.push(() => finish('end_turn'));
        return;
      }
      if (text.includes('ASK') || mode === 'live') {
        if (mode === 'live') {
          update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
          update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } });
          update(sessionId, {
            sessionUpdate: 'tool_call',
            toolCallId: 'live-call',
            title: 'Read the floor',
            kind: 'read',
            status: 'in_progress',
            rawInput: { path: 'floor' },
          });
        }
        const ask = () => {
          update(sessionId, {
            sessionUpdate: 'tool_call',
            toolCallId: 'exec_1',
            title: 'Run git push',
            kind: 'execute',
            status: 'pending',
            rawInput: { command: 'git push' },
          });
          const options = [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'always', name: 'Always', kind: 'allow_always' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ];
          const twice = text.includes('TWICE');
          if (twice) doubled.pending = new Set(['p1', 'p2']);
          else asking = 'p1';
          send({ id: 'p1', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'exec_1' }, options } });
          if (!twice) return;
          update(sessionId, {
            sessionUpdate: 'tool_call',
            toolCallId: 'exec_2',
            title: 'Run git push --tags',
            kind: 'execute',
            status: 'pending',
            rawInput: { command: 'git push --tags' },
          });
          send({ id: 'p2', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'exec_2' }, options } });
        };
        if (mode !== 'live') ask();
        else {
          let fired = false;
          const ready = () => {
            if (fired || !existsSync(`${report}.ask`)) return;
            fired = true;
            watcher.close();
            ask();
          };
          const watcher = watch(dirname(report), ready);
          ready();
        }
        return;
      }
      if (text.includes('HOLD')) return;
      if (mode === 'tagma' && text.includes('DRIFT')) {
        update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'open', content: { type: 'text', text: 'Partial' } });
        held.push(() => {
          const read = { toolCallId: 'drift-read', title: 'Read fixture.ts', kind: 'read', rawInput: { path: 'fixture.ts' } };
          update(sessionId, { sessionUpdate: 'tool_call', ...read, status: 'in_progress' });
          update(sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000, _meta: { 'tagma/measured': measured } });
          update(sessionId, {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'drift-read',
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: 'fixture' } }],
          });
          update(sessionId, { sessionUpdate: 'tool_call', ...read, toolCallId: 'drift-next', status: 'in_progress' });
        });
        return;
      }
      if (mode === 'tagma' && (text.includes('STREAM') || text.includes('SELFCANCEL'))) {
        update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'open', content: { type: 'text', text: 'Partial' } });
        if (text.includes('CONTEXT')) update(sessionId, { sessionUpdate: 'usage_update', used: 960, size: 200_000 });
        if (text.includes('SELFCANCEL')) later(() => finish('cancelled'));
        return;
      }
      if (mode === 'tagma' && (text.includes('TRUNCATE') || text.includes('REFUSE'))) {
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Partial' } });
        finish(text.includes('TRUNCATE') ? 'max_tokens' : 'refusal');
        return;
      }
      if (mode === 'tagma' && text.includes('RATELIMIT') && limitedHere()) {
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'API Error: Rate limited' } });
        send({ id: prompt.id, error: { code: -32603, message: 'Rate limited', data: { 'tagma/failure': RATE_LIMITED } } });
        prompt = null;
        return;
      }
      if (text.includes('<keep-warm>')) {
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } });
        finish('end_turn');
        return;
      }
      if (text.includes('WAIT')) {
        let released = false;
        const ready = () => {
          if (released || !existsSync(`${report}.release`)) return;
          released = true;
          watcher.close();
          update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'waited' } });
          finish('end_turn');
        };
        const watcher = watch(dirname(report), ready);
        ready();
        return;
      }
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'echo: ' } });
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'heard' } });
      update(sessionId, { sessionUpdate: 'usage_update', used: 120, size: 1000 });
      finish('end_turn');
      return;
    }
    default:
      if (message.id !== undefined) send({ id: message.id, error: { code: -32601, message: `no ${message.method}` } });
  }
};

let pending = '';
const decoder = new TextDecoder();
process.stdin.on('data', (chunk: Buffer) => {
  pending += decoder.decode(chunk, { stream: true });
  for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    if (line.trim() === '') continue;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      appendFileSync(report, `${JSON.stringify({ error: { unreadable: line.length } })}\n`);
      send({ id: null, error: { code: -32700, message: 'the line is not JSON' } });
      continue;
    }
    appendFileSync(report, `${line}\n`);
    handle(message);
  }
});
