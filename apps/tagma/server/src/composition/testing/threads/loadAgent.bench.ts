import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

if (process.argv.includes('--version')) {
  process.stdout.write('load-agent fixture\n');
  process.exit(0);
}

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing ${name}`);
  return value;
};

const absolute = (name: string): string => {
  const value = argument(name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
};

const report = absolute('--report');
const planPath = absolute('--plan');
const go = absolute('--go');
const progressDirectory = process.argv.includes('--progress-dir') ? absolute('--progress-dir') : undefined;
const rate = Number(argument('--rate'));
if (!Number.isFinite(rate) || rate <= 0) throw new Error('--rate must be positive and finite');
const optionalNumber = (name: string, fallback: number): number => (process.argv.includes(name) ? Number(argument(name)) : fallback);
const messageBytes = optionalNumber('--message-bytes', 1024);
const callsPerBoundary = optionalNumber('--calls-per-boundary', 1);
const phase = optionalNumber('--phase', 0);
const agentIndex = optionalNumber('--agent-index', 0);
const turnMin = optionalNumber('--turn-min', 0);
const turnMax = optionalNumber('--turn-max', turnMin === 0 ? 0 : 50);
if (!Number.isSafeInteger(messageBytes) || messageBytes < 0) throw new Error('--message-bytes must be a nonnegative safe integer');
if (callsPerBoundary !== 1 && callsPerBoundary !== 8) throw new Error('--calls-per-boundary must be 1 or 8');
if (!Number.isFinite(phase) || phase < 0) throw new Error('--phase must be nonnegative and finite');
if (
  ![agentIndex, turnMin, turnMax].every(Number.isSafeInteger) ||
  agentIndex < 0 ||
  turnMin < 0 ||
  turnMax < turnMin ||
  (turnMin === 0 && turnMax !== 0)
)
  throw new Error('invalid finite-turn limits');
const idle = process.argv.includes('--idle');
type Call = { readonly name: string; readonly input: Record<string, unknown> };
const decoded: unknown = JSON.parse(readFileSync(planPath, 'utf8'));
if (
  !Array.isArray(decoded) ||
  decoded.length === 0 ||
  decoded.some(
    (call: unknown) =>
      call === null ||
      typeof call !== 'object' ||
      typeof (call as Record<string, unknown>).name !== 'string' ||
      (call as Record<string, unknown>).name === '' ||
      (call as Record<string, unknown>).input === null ||
      typeof (call as Record<string, unknown>).input !== 'object' ||
      Array.isArray((call as Record<string, unknown>).input),
  )
) {
  throw new Error('--plan must contain a nonempty array of calls with name and object input');
}
const plan = decoded as Call[];

type Message = {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
};
type Prompt = { readonly id: string | number; readonly sessionId: string; readonly turn: unknown };

const send = (message: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
};
const update = (sessionId: string, body: Record<string, unknown>): void => {
  send({ method: 'session/update', params: { sessionId, update: body } });
};
const extensions = [
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
const current: Record<string, string> = { model: 'claude-opus-5-5', effort: 'medium', thinking: 'omitted' };
const choices: Record<string, readonly string[]> = {
  model: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  effort: ['low', 'medium', 'high', 'xhigh'],
  thinking: ['summarized', 'omitted'],
};
const config = () =>
  Object.entries(choices).map(([id, options]) => ({
    id,
    name: id,
    type: 'select',
    currentValue: current[id],
    options: options.map((value) => ({ value, name: value })),
  }));

let prompt: Prompt | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let watcher: FSWatcher | undefined;
let frame = 0;
let cycle = 0;
let nextAt = 0;
let hosted: { readonly toolCallId: string; readonly name: string; readonly input: Record<string, unknown> }[] = [];
let vendors: string[] = [];
let messageNumber = 0;
let chunks = 0;
let emittedFrames = 0;
let hostedAnnounced = 0;
let callsOffered = 0;
let turns = 0;
let turnsEnded = 0;
let callsInTurn = 0;
let turnTarget = 0;
let waitingForEnd = false;
let textBytesInTurn = 0;
let turnBeganAt = 0;
const period = 1000 / rate;
const progress = (): void => {
  if (progressDirectory === undefined) return;
  const agent = basename(report);
  const path = join(progressDirectory, `${agent}.json`);
  const staged = `${path}.tmp`;
  writeFileSync(
    staged,
    JSON.stringify({
      agent,
      recordedAt: new Date().toISOString(),
      emittedFrames,
      hostedAnnounced,
      callsOffered,
      turns,
      turnsEnded,
      callsInTurn,
      turnTarget,
      stdoutBufferedBytes: process.stdout.writableLength,
    }),
  );
  renameSync(staged, path);
};
progress();
const turnEvent = (value: object): void => appendFileSync(`${report}.turns`, `${JSON.stringify(value)}\n`);

const stop = (): void => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  watcher?.close();
  watcher = undefined;
};

const tick = (): void => {
  timer = undefined;
  if (prompt === null) return;
  const sessionId = prompt.sessionId;
  const slot = frame % 26;
  const messageId = `message-${messageNumber}`;
  const vendor = `vendor-${cycle}`;
  const boundaryCalls = turnTarget === 0 ? callsPerBoundary : Math.min(callsPerBoundary, turnTarget - callsInTurn);
  const textChunks = 22 * boundaryCalls - 1;
  if (slot === 0) {
    const call = plan[cycle % plan.length]!;
    const announced = { toolCallId: `hosted-${cycle}`, name: call.name, input: call.input };
    hosted.push(announced);
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: announced.toolCallId,
      title: announced.name,
      name: announced.name,
      kind: 'other',
      status: 'pending',
      rawInput: announced.input,
      _meta: { 'tagma/executes': true },
    });
    hostedAnnounced += 1;
  } else if (slot === 8) {
    vendors.push(vendor);
    update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: vendor,
      title: 'Read fixture',
      kind: 'read',
      status: 'pending',
      rawInput: { path: 'fixture.ts' },
    });
  } else if (slot === 9) {
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: vendor, status: 'in_progress' });
  } else if (slot === 10) {
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: vendor,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'fixture' } }],
    });
  } else if (slot === 25 && hosted.length === boundaryCalls) {
    send({ method: '_tagma/said', params: { sessionId, messageId, toolCallIds: [...hosted.map((call) => call.toolCallId), ...vendors] } });
    appendFileSync(`${report}.calls`, hosted.map((call) => `${JSON.stringify(call)}\n`).join(''));
    callsOffered += hosted.length;
    callsInTurn += hosted.length;
    hosted = [];
    vendors = [];
    messageNumber += 1;
    chunks = 0;
  } else {
    const size = Math.floor(messageBytes / textChunks) + (chunks < messageBytes % textChunks ? 1 : 0);
    chunks += 1;
    textBytesInTurn += size;
    update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: 'x'.repeat(size) } });
  }
  frame += 1;
  emittedFrames += 1;
  if (frame % 26 === 0) {
    cycle += 1;
    progress();
  }
  if (turnTarget > 0 && callsInTurn >= turnTarget) {
    waitingForEnd = true;
    const ending = () => {
      const path = `${report}.end-turn`;
      if (!waitingForEnd || !existsSync(path)) return;
      rmSync(path);
      waitingForEnd = false;
      turnsEnded += 1;
      progress();
      finish('end_turn');
    };
    watcher = watch(dirname(report), ending);
    turnEvent({
      type: 'sealed',
      turn: turns,
      calls: callsInTurn,
      offered: callsOffered,
      textBytes: textBytesInTurn,
      beganAt: turnBeganAt,
      at: Date.now(),
    });
    ending();
    return;
  }
  nextAt += period;
  timer = setTimeout(tick, Math.max(0, nextAt - performance.now()));
};

const start = (): void => {
  if (prompt === null || idle || timer !== undefined || waitingForEnd || !existsSync(go)) return;
  if (turnMin > 0 && turns > 1) {
    const path = `${report}.continue`;
    if (!existsSync(path)) return;
    rmSync(path);
  }
  watcher?.close();
  watcher = undefined;
  const delay = turns === 1 ? phase : 0;
  turnBeganAt = Date.now() + delay;
  nextAt = performance.now() + delay;
  timer = setTimeout(tick, delay);
};

const finish = (stopReason: string): void => {
  stop();
  if (prompt === null) return;
  const { id, turn } = prompt;
  prompt = null;
  send({
    id,
    result: {
      stopReason,
      ...(typeof turn === 'string' ? { _meta: { 'tagma/turn': { prompt: turn, last: `last-${turn}` }, 'tagma/opened': true } } : {}),
    },
  });
};

const handle = (message: Message): void => {
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize':
      send({
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: { resume: {}, close: {} },
            promptCapabilities: { image: false },
            _meta: { 'tagma/extensions': extensions },
          },
          authMethods: [],
        },
      });
      return;
    case 'session/new':
      send({ id: message.id, result: { sessionId: 'sess-1', configOptions: config() } });
      return;
    case 'session/load':
    case 'session/resume':
      send({ id: message.id, result: { configOptions: config() } });
      return;
    case 'session/close':
      finish('cancelled');
      send({ id: message.id, result: {} });
      return;
    case 'session/set_config_option': {
      const id = String(params.configId);
      const value = String(params.value);
      if (!choices[id]?.includes(value)) {
        send({ id: message.id, error: { code: -32602, message: `${id} has no ${value}` } });
        return;
      }
      current[id] = value;
      send({ id: message.id, result: { configOptions: config() } });
      return;
    }
    case 'session/set_mode':
      send({ id: message.id, result: {} });
      return;
    case 'session/prompt': {
      if (message.id === undefined || prompt !== null) {
        if (message.id !== undefined) send({ id: message.id, error: { code: -32600, message: 'a prompt is already running' } });
        return;
      }
      const meta = params._meta as Record<string, unknown> | undefined;
      prompt = { id: message.id, sessionId: String(params.sessionId), turn: meta?.['tagma/turn'] };
      if (process.argv.includes('--prime') && !existsSync(`${report}.primed`)) {
        writeFileSync(`${report}.primed`, 'ready\n');
        update(prompt.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: 'prime', content: { type: 'text', text: 'ready' } });
        finish('end_turn');
        return;
      }
      if (frame % 26 !== 0) cycle += 1;
      if (hosted.length > 0) messageNumber += 1;
      hosted = [];
      vendors = [];
      chunks = 0;
      frame = 0;
      turns += 1;
      callsInTurn = 0;
      textBytesInTurn = 0;
      turnTarget = idle || turnMin === 0 ? 0 : turnMin + ((agentIndex * 17 + (turns - 1) * 23) % (turnMax - turnMin + 1));
      if (!idle) watcher = watch(dirname(go), start);
      writeFileSync(`${report}.ready`, 'ready\n');
      if (turnMin > 0 && !idle) turnEvent({ type: 'prompt', turn: turns, run: prompt.turn, target: turnTarget, at: Date.now() });
      progress();
      start();
      return;
    }
    case 'session/cancel':
      finish('cancelled');
      return;
    case '_tagma/aside':
      send({ id: message.id, result: { text: 'load agent' } });
      return;
    case '_tagma/steer':
      send({ id: message.id, result: { outcome: prompt === null ? 'promptRequired' : 'injected' } });
      return;
    case '_tagma/withdraw':
      send({ id: message.id, result: { withdrawn: false } });
      return;
    case '_tagma/fork':
    case '_tagma/rewind':
      send({ id: message.id, result: { sessionId: 'sess-1', configOptions: config() } });
      return;
    case '_tagma/compact':
      send({ id: message.id, error: { code: -32010, message: 'the load agent does not compact' } });
      return;
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
    if (line.trim() !== '') handle(JSON.parse(line) as Message);
  }
});
process.stdin.on('end', stop);
