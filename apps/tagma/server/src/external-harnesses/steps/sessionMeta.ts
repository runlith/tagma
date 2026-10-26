import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

const UNMEASURED: Held = {
  binding: { sessionId: null, execution: null, rootKey: null },
  revision: 0,
  metadata: { model: { _tag: 'NotRead' }, effort: { _tag: 'NotRead' }, title: { _tag: 'NotRead' } },
  diagnostics: [],
};

const PROVIDERS: Readonly<Record<string, string>> = { 'claude-code': 'claude-code', codex: 'codex', devin: 'devin' };

const ACP: Readonly<Record<string, Held>> = {
  'claude-code': { web: 'vendor', callEnvelopeMs: 1_200_000, continue: true, usage: 'measured', aside: 'session' },
};

const ACP_UNPROVEN: Held = { web: 'none', callEnvelopeMs: null, continue: false, usage: 'none', aside: 'none' };

const LAWLESS = new Set(['grok', 'gemini']);

const ACTIVE_SESSION = new Set(['starting', 'running', 'stopping', 'uncertain']);

const SEATING = ['transport', 'hosts', 'proves', 'asked', 'question'];

const explicitShape = (held: Held): Held => {
  const text = JSON.stringify(held).replaceAll('"why":"legacy-row"', '"why":"unproven-source"');
  const { model, ...whole } = JSON.parse(text) as Held;
  const standing = (whole.observation as Held | undefined) ?? structuredClone(UNMEASURED);
  const { work: _work, receipts, turns: _turns, ...observation } = standing;
  const { observation: _observation, ...rest } = whole;
  const seen = Array.isArray(receipts) && receipts.length > 0 ? receipts : undefined;
  const metadata = (observation.metadata ?? {}) as Held;
  const carried = typeof model === 'string' && model.trim().length > 0 ? model.trim() : null;
  const unread = (metadata.model as Held | undefined)?._tag === 'NotRead' || metadata.model === undefined;
  const lived = rest.session as Held | undefined;
  const {
    reported: _reported,
    finishedAt: _finished,
    outcome: _outcome,
    failure: _failure,
    hostStateFailure: _host,
    ...session
  } = lived ?? {};
  return {
    ...rest,
    seen: seen ?? rest.seen,
    execution: rest.execution ?? null,
    session: lived === undefined ? rest.session : { ...session, origin: session.origin ?? 'launched' },
    observation: {
      ...observation,
      metadata: {
        model:
          unread && carried !== null
            ? {
                _tag: 'Stale',
                lastKnown: { value: carried, claim: null, source: null, scope: null, observedAt: null, why: 'unproven-source' },
              }
            : (metadata.model ?? { _tag: 'NotRead' }),
        effort: metadata.effort ?? { _tag: 'NotRead' },
        title: metadata.title ?? { _tag: 'NotRead' },
      },
    },
  };
};

const asked = (held: Held): { readonly model: unknown; readonly reasoning: unknown } => {
  const choice = isRecord(held.asked) ? held.asked : {};
  return { model: choice.model ?? null, reasoning: choice.model === undefined ? null : (choice.reasoning ?? null) };
};

const acpKernel = (id: string, held: Held): Held => {
  const proves = isRecord(held.proves) ? held.proves : {};
  const name = held.name as string;
  const choice = isRecord(held.asked) ? held.asked : {};
  const { web, callEnvelopeMs, continue: continues, usage, aside } = ACP[name] ?? ACP_UNPROVEN;
  return {
    id,
    cacheGroup: id,
    provider: PROVIDERS[name] ?? 'external',
    model: choice.model ?? null,
    reasoning: choice.reasoning ?? null,
    transport: { adapter: 'acp', profile: name, agent: held.hosts ?? null },
    capabilities: {
      messaging: true,
      judgedModel: false,
      steer: name === 'claude-code' ? 'step' : 'none',
      withdraw: name === 'claude-code',
      history: proves.fork === true && proves.rewind === true ? 'session' : 'none',
      compaction: proves.compaction === true ? 'session' : 'none',
      modelMove: 'live',
      openings: 'core',
      pictures: true,
      web,
      law: proves.law ?? null,
      touch: proves.touch ?? null,
      authorship: proves.authorship ?? null,
      callEnvelopeMs,
      screen: false,
      continue: continues,
      feed: 'full',
      usage,
      aside,
    },
  };
};

const terminalKernel = (id: string, held: Held): Held => {
  const name = held.name as string;
  return {
    id,
    cacheGroup: id,
    provider: PROVIDERS[name] ?? 'external',
    ...asked(held),
    transport: { adapter: 'terminal', profile: name, agent: null },
    capabilities: {
      messaging: true,
      judgedModel: false,
      steer: 'none',
      withdraw: false,
      history: 'none',
      compaction: 'none',
      modelMove: 'pinned',
      openings: 'core-and-observed',
      pictures: false,
      web: 'none',
      law: LAWLESS.has(name) ? null : 'asked-calls',
      touch: 'reads-and-writes',
      authorship: 'observed',
      callEnvelopeMs: null,
      screen: true,
      continue: false,
      feed: 'turns',
      usage: name === 'claude-code' ? 'partial' : 'none',
      aside: 'none',
    },
  };
};

const atRest = (held: Held): Held => {
  const session = held.session as Held | undefined | null;
  const resting =
    session === undefined || session === null || !ACTIVE_SESSION.has(session.state as string)
      ? session
      : { ...session, state: 'ended', ownerId: null };
  return { ...held, session: resting, execution: held.execution === undefined ? undefined : null };
};

const unseated = (held: Held): Held => Object.fromEntries(Object.entries(held).filter(([key]) => !SEATING.includes(key)));

const oldAcp = (held: Held): boolean => held.transport === 'acp' || (held.transport === undefined && ('proves' in held || 'hosts' in held));

const seated = (id: string, facet: Held): { readonly facet: Held; readonly kernel: Held | null } => {
  if (oldAcp(facet)) return { facet: atRest(explicitShape(unseated(facet))), kernel: acpKernel(id, facet) };
  if (facet.transport === 'terminal') return { facet: atRest(explicitShape(unseated(facet))), kernel: terminalKernel(id, facet) };
  return { facet: explicitShape(facet), kernel: null };
};

const boundNative = (native: unknown, kernel: Held): Held => {
  if (!isRecord(native)) return kernel;
  if ((kernel.transport as Held).adapter === 'terminal') return native;
  const { id: _id, cacheGroup: _group, ...bound } = kernel;
  return { ...native, ...bound };
};

const legacySession = (meta: Held): Held | null => {
  const old = meta.thread as Held;
  const harness = isRecord(meta.facet) ? meta.facet.harness : null;
  return isRecord(harness) ? { id: old.id, facet: harness, updatedAt: old.updatedAt } : null;
};

export const sessionMetaForm: ThreadFormStep = {
  name: '20261019050000_external_session_meta',
  samples: {
    meta: {
      thread: { id: 't', updatedAt: '2026-08-25T10:00:00.000Z' },
      facet: {
        harness: {
          name: 'claude-code',
          transport: 'terminal',
          model: 'sonnet',
          session: { id: 's', state: 'running', ownerId: 'server', outcome: 'failed' },
          execution: { pid: 1 },
        },
      },
    },
  },
  meta: (meta) => {
    const legacy = meta.external === undefined && meta.record === undefined && isRecord(meta.thread);
    const external = legacy ? legacySession(meta) : meta.external;
    if (!isRecord(external) || !isRecord(external.facet)) return legacy ? { ...meta, external } : null;
    const { facet, kernel } = seated(external.id as string, external.facet);
    if (!legacy && kernel === null && JSON.stringify(facet) === JSON.stringify(external.facet)) return null;
    const formed = { ...meta, external: { ...external, facet } };
    return kernel === null ? formed : { ...formed, native: boundNative(meta.native, kernel) };
  },
};
