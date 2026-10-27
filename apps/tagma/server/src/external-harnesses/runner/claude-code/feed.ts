import { Clock, Effect } from 'effect';
import type { AgentFault, Outlet } from '@runlith/acp/agent';
import type { SessionUpdate } from '@runlith/acp/updates';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentPhase } from '@runlith/agent/AgentPhase';
import { INPUT, PHASE, RETRYING } from '../../contract/wire/extensions.js';
import { retryFamilyOf } from '../../vendors/claude-code/failure.js';
import { Inputs } from './inputs.js';
import type { Handed } from '../hosted/handed.js';
import { Meter } from './meter.js';
import type { Names } from './names.js';
import { Phases } from './phases.js';
import type { Runner } from './runner.js';
import type { Settings } from './settings.js';
import type { Spend } from './spend.js';
import { SessionTitle } from './title.js';
import { Translation } from './translate.js';
import { failed } from './calls.js';
import { Output } from '../hosted/output.js';

export class Feed {
  private readonly translation: Translation;
  private readonly meter: Meter;
  private readonly title: SessionTitle;
  private readonly phases = new Phases();
  private readonly inputs = new Inputs();
  private readonly output: Output;

  constructor(
    id: string,
    cwd: string,
    outlet: Outlet,
    private readonly settings: Settings,
    runner: Runner,
    handed: Handed,
    names: Names,
    spend: Spend,
  ) {
    this.translation = new Translation(handed, names);
    this.output = new Output(id, outlet, handed);
    this.meter = new Meter(settings, spend);
    this.title = new SessionTitle(id, cwd, runner.stderr);
  }

  emit(updates: ReadonlyArray<SessionUpdate>): Effect.Effect<void> {
    return this.output.emit(updates);
  }

  notify(method: string, fields: Readonly<Record<string, unknown>>): Effect.Effect<void> {
    return this.output.notify(method, fields);
  }

  readonly heard = Effect.fnUntraced(function* (this: Feed) {
    this.meter.heard(yield* Clock.currentTimeMillis);
    yield* this.entered(this.phases.heard());
  });

  readonly streamed = Effect.fnUntraced(function* (this: Feed, event: unknown) {
    const read = this.translation.stream(event);
    const measured = this.meter.streamed(event, yield* Clock.currentTimeMillis);
    const updates = measured === null ? read.updates : [...read.updates, measured];
    const said = read.said;
    const input = this.inputs.streamed(event);
    yield* this.entered(this.phases.streamed(event));
    yield* this.emit(updates);
    if (input !== null) yield* this.notify(INPUT, input);
    if (said !== null) yield* this.output.said(said);
  });

  readonly noted = Effect.fnUntraced(function* (this: Feed, message: Extract<SDKMessage, { readonly type: 'system' }>) {
    if (message.subtype === 'api_retry') {
      this.meter.retried(message.attempt);
      yield* this.notify(RETRYING, {
        uuid: message.uuid,
        attempt: message.attempt,
        of: message.max_retries,
        delayMs: message.retry_delay_ms,
        family: retryFamilyOf(message.error, message.error_status),
        httpStatus: message.error_status,
        message: message.error,
      });
    }
    yield* this.entered(this.phases.noted(message));
  });

  private entered(phase: AgentPhase['phase'] | null): Effect.Effect<void> {
    return phase === null ? Effect.void : this.notify(PHASE, { phase });
  }

  assistant(message: unknown): Effect.Effect<void, AgentFault> {
    return Effect.flatMap(
      Effect.fromResult(this.translation.assistant(message)).pipe(
        Effect.mapError((cause) => failed(`Claude Code answered an assistant message this runner cannot read: ${cause.message}`)),
      ),
      ({ updates, said }) => Effect.andThen(this.emit(updates), said === null ? Effect.void : this.output.said(said)),
    );
  }

  started(toolCallId: string): Effect.Effect<void> {
    return this.emit(this.translation.started(toolCallId));
  }

  user(message: unknown, structured: unknown): Effect.Effect<void> {
    return this.emit(this.translation.user(message, structured));
  }

  readonly titled = Effect.fnUntraced(function* (this: Feed) {
    const title = this.settings.titled ? yield* this.title.fresh() : null;
    if (title !== null) yield* this.emit([{ sessionUpdate: 'session_info_update', title }]);
  });
}
