import { Effect } from 'effect';
import { FAULT } from '@runlith/acp/agent';
import type { ClientEvent } from '@runlith/acp/events';
import type { InitializeResult, SessionSetup } from '@runlith/acp/methods';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { ProtocolAlignment } from './alignment.js';
import { ASIDE, COMPACT, FORK, REWIND, STEER, WITHDRAW } from '@runlith/hosted-runner/wire/extensions';
import type { ProtocolHalts } from './halts.js';
import type { Link } from './links.js';
import type { ProtocolPrompts } from './prompts.js';
import { negotiates, negotiating } from './row.js';
import { IDLE, type Persisted, type ProtocolSteps } from './steps.js';

export class ProtocolOpening {
  constructor(
    private readonly steps: ProtocolSteps,
    private readonly halts: ProtocolHalts,
    private readonly prompts: ProtocolPrompts,
    private readonly rows: ProtocolRows,
    private readonly alignment: ProtocolAlignment,
  ) {}

  readonly initialized = Effect.fnUntraced(function* (this: ProtocolOpening, link: Link, result: InitializeResult) {
    const { steps, rows } = this;
    const capabilities = result.agentCapabilities;
    const meta = capabilities?._meta;
    const declared = typeof meta === 'object' && meta !== null && 'tagma/extensions' in meta ? meta['tagma/extensions'] : null;
    const extensions = Array.isArray(declared) ? link.profile.extensions.filter((method) => declared.includes(method)) : [];
    if (link.profile.hosts === null) {
      const { proves } = link.profile;
      const missing = [
        proves.fork && !extensions.includes(FORK) ? 'fork' : null,
        proves.rewind && !extensions.includes(REWIND) ? 'rewind' : null,
        proves.compaction === true && !extensions.includes(COMPACT) ? 'compaction' : null,
        proves.aside === 'session' && !extensions.includes(ASIDE) ? 'aside' : null,
      ].filter((capability) => capability !== null);
      if (missing.length > 0) {
        yield* this.halts.failed(
          link,
          new GateRefusal('harness-contract', `The agent did not negotiate claimed capabilities: ${missing.join(', ')}.`, [
            'use an agent that supports the declared capabilities or correct the adapter profile',
          ]),
        );
        return IDLE;
      }
    }
    yield* steps.intend(link, { _tag: 'Extensions', methods: extensions });
    const sessions = capabilities?.sessionCapabilities;
    const methods = result.authMethods ?? [];
    const agent = {
      load: capabilities?.loadSession === true,
      resume: sessions?.resume != null,
      close: sessions?.close != null,
      login: methods.length === 0 ? null : methods.map((method) => method.name).join(', '),
      image: capabilities?.promptCapabilities?.image === true,
    };
    yield* steps.persist(link, { row: (row) => ({ ...row, agent }) });
    const steers = link.profile.midTurn === 'steer' && extensions.includes(STEER);
    yield* rows.declare(link.threadId, {
      pictures: agent.image,
      steer: steers ? 'step' : 'none',
      withdraw: steers && extensions.includes(WITHDRAW),
      toolCatalog: link.profile.toolCatalog,
    });
    return yield* this.open(link, agent.resume ? 'resume' : agent.load ? 'load' : 'new');
  });

  moded(link: Link, modeId: string): Effect.Effect<Persisted | null, HarnessFailure> {
    if (modeId === link.profile.mode) return this.changed(link);
    const key = link.facet.sessionKey;
    return link.row.client.requests.some((request) => request.meaning === 'mode') || key === null
      ? Effect.succeed(null)
      : this.steps.intend(link, { _tag: 'SetMode', params: { sessionId: key, modeId: link.profile.mode } });
  }

  changed(link: Link): Effect.Effect<Persisted, HarnessFailure> {
    return link.row.phase === 'opening' ? this.opened(link) : this.prompts.prompt(link);
  }

  readonly configured = Effect.fn('ProtocolOpening.configured')(function* (
    this: ProtocolOpening,
    link: Link,
    sessionId: string,
    setup: SessionSetup,
  ) {
    if (setup.modes?.currentModeId === link.profile.mode) return yield* this.opened(link);
    return yield* this.steps.intend(link, { _tag: 'SetMode', params: { sessionId, modeId: link.profile.mode } });
  });

  readonly refused = Effect.fnUntraced(function* (
    this: ProtocolOpening,
    link: Link,
    event: Extract<ClientEvent, { readonly _tag: 'RequestFailed' }>,
  ) {
    const { halts } = this;
    const meaning = event.request.meaning;
    if (!negotiates(meaning)) return null;
    if (meaning === 'configure') return yield* this.alignment.refused(link, event);
    const cause = event.cause;
    const code = cause._tag === 'Agent' ? cause.error.code : null;
    const said = cause._tag === 'Agent' ? cause.error.message : cause._tag;
    const profile = link.profile;
    if ((meaning === 'load' || meaning === 'resume') && code !== null && code === profile.lockedCode) {
      const holder = cause._tag === 'Agent' && cause.error.data !== undefined ? ` (${JSON.stringify(cause.error.data)})` : '';
      yield* halts.failed(
        link,
        new GateRefusal('session-locked', `Another ${link.name} process holds this vendor session${holder}: ${said}`, [
          'stop the other process, then start this thread again',
        ]),
      );
      return null;
    }
    if ((meaning === 'load' || meaning === 'resume') && code === FAULT.notFound) return yield* this.open(link, 'new');
    if (code !== null && profile.login.codes.includes(code) && (meaning === 'new' || meaning === 'initialize')) {
      const methods = link.row.agent?.login;
      yield* halts.failed(
        link,
        new GateRefusal(
          'harness-login',
          `${link.name} is not signed in${methods === null || methods === undefined ? '' : ` (it offers ${methods})`}: ${said}`,
          [`run \`${profile.login.command}\`, then start the thread again`],
        ),
      );
      return null;
    }
    yield* halts.failed(
      link,
      new GateRefusal('session-failed', `The agent refused ${meaning}: ${said}`, [
        'read the agent diagnostics, then start the thread again',
      ]),
    );
    return null;
  });

  private readonly open = Effect.fn('ProtocolOpening.open')(function* (this: ProtocolOpening, link: Link, via: 'resume' | 'load' | 'new') {
    const { halts, steps, alignment } = this;
    const cwd = yield* alignment.cwd(link);
    if (cwd === null) return IDLE;
    const key = link.facet.sessionKey;
    if (link.row.fork !== null) {
      if (link.row.fork.account !== (link.facet.session?.account?.key ?? null)) return yield* alignment.fresh(link, cwd);
      if (!link.row.client.extensions.includes(FORK) && link.profile.hosts !== null && link.profile.proves.fork) {
        return yield* alignment.fresh(link, cwd);
      }
      if (!link.row.client.extensions.includes(FORK)) {
        yield* halts.failed(
          link,
          new GateRefusal('harness-contract', 'The agent did not announce fork support.', [
            'switch the thread to native, which supports this history operation',
          ]),
        );
        return IDLE;
      }
      return yield* steps.intend(
        link,
        {
          _tag: 'Extend',
          method: FORK,
          envelopes: [],
          params: { sessionId: link.row.fork.session, cwd, turn: link.row.fork.prompt },
        },
        { row: (row) => ({ ...row, phase: 'opening' }) },
      );
    }
    if (key === null || via === 'new') return yield* alignment.fresh(link, cwd);
    return yield* steps.intend(
      link,
      via === 'resume'
        ? { _tag: 'ResumeSession', params: { sessionId: key, cwd, mcpServers: [] } }
        : { _tag: 'LoadSession', params: { sessionId: key, cwd, mcpServers: [] } },
      { row: (row) => ({ ...row, phase: 'opening' }) },
    );
  });

  private readonly opened = Effect.fnUntraced(function* (this: ProtocolOpening, link: Link) {
    if (negotiating(link.row)) return IDLE;
    yield* this.steps.persist(link, { row: (row) => ({ ...row, phase: 'ready' }) });
    return yield* this.prompts.prompt(link);
  });
}
