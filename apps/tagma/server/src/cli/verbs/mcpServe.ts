import { Effect, Logger, Schema, Stream } from 'effect';
import { APPROVAL_WAIT_MS } from '../../platform/contract/wire/approval.js';
import { Command, Flag } from 'effect/cli';
import { serveMcpOverStdio, type McpServedResult } from '@runlith/mcp/server';
import { McpServeFailed } from '@runlith/mcp/McpFailure';
import { CapabilitySettingsReading } from '../../native-harness/contract/wire/operations/capabilities.js';
import {
  ANSWER_HEADER,
  ANSWER_TEXT,
  CALL_HEADER,
  CALL_META,
  APPROVAL_WAIT_HEADER,
  answerParts,
  MEDIA_HEADER,
  MEDIA_INLINE,
  OUTCOME_HEADER,
} from '../../invocation/contract/wire/headers.js';
import { mcpCatalog } from '../mcpTools.js';
import type { BridgedHarness, OperationsCli } from '../contract/service/operations.js';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { MCP_KEY_VARIABLE } from '../../platform/contract/wire/session.js';
import { CallerSignal, lens } from '../door.js';
import { AGAIN_AFTER_SILENCE, unanswered } from '../../platform/cli/silence.js';
import { refusalOf, refuse, CurrentInvocation, type Invocation } from '../../platform/cli/verb.js';

const refused = (refusal: RefusalBody, json: boolean): McpServedResult => ({
  text: json ? JSON.stringify({ status: 'refused', ...refusal }, null, 2) : refusalLines(refusal).join('\n'),
  isError: true,
});

const answered = (value: unknown, json: boolean, negative: boolean): McpServedResult => {
  const { document, text, media } = answerParts(value);
  return {
    text: !json && text !== undefined ? text : JSON.stringify(document, null, 2),
    media: media.length === 0 ? undefined : media.map((one) => ({ type: 'image' as const, data: one.data, mimeType: one.mimeType })),
    isError: negative,
  };
};

const metaText = (meta: Readonly<Record<string, unknown>>, key: string | undefined): string | undefined => {
  const named = key === undefined ? undefined : meta[key];
  return typeof named === 'string' && named.trim() !== '' ? named.trim() : undefined;
};

const callKey = (meta: Readonly<Record<string, unknown>>, harness: BridgedHarness, bridge: string, requestId: string | number): string =>
  metaText(meta, CALL_META) ?? metaText(meta, harness.mcpCallMeta) ?? JSON.stringify([bridge, requestId]);

const performed = (
  { ask, baseUrl }: Pick<OperationsCli<string, string>, 'ask' | 'baseUrl'>,
  at: Invocation,
  name: string,
  input: unknown,
  json: boolean,
  key: string,
  project?: string | number,
): Effect.Effect<McpServedResult> => {
  const asked = { [CALL_HEADER]: key, [APPROVAL_WAIT_HEADER]: String(APPROVAL_WAIT_MS), [MEDIA_HEADER]: MEDIA_INLINE };
  const unanswered = (at: Invocation, failure: unknown): McpServedResult =>
    refused(
      {
        code: 'server-unanswered',
        reason: `the Tagma at ${baseUrl(at)} gave this call no answer this bridge could read: ${failure instanceof Error ? failure.message : String(failure)}`,
        unblock: [
          'tagma status — whether a server is standing there at all',
          'tagma serve — start one if none is',
          'TAGMA_SERVER_URL / TAGMA_PORT — if it listens elsewhere',
          'a standing server that broke writes the whole failure to its own log',
        ],
      },
      json,
    );
  return ask((door) =>
    door.operations.perform({
      params: { id: name },
      query: lens(at, project === undefined ? {} : { project: String(project) }),
      headers: json ? asked : { ...asked, [ANSWER_HEADER]: ANSWER_TEXT },
      payload: input,
      responseMode: 'decoded-and-response',
    }),
  ).pipe(
    Effect.match({
      onSuccess: ([value, response]) => answered(value, json, response.headers[OUTCOME_HEADER] === 'negative'),
      onFailure: (failure) => {
        const refusal = refusalOf(failure);
        return refusal === null ? unanswered(at, failure) : refused(refusal, json);
      },
    }),
    Effect.provideService(CurrentInvocation, at),
  );
};

export const mcpServe = <Id extends string, Harness extends string>(cli: OperationsCli<Id, Harness>) => {
  const harness = Flag.Literals('harness', cli.harnesses).pipe(
    Flag.withMetavar(cli.harnesses.join('|')),
    Flag.withDescription('the CLI whose configuration this declaration was written into'),
  );
  const catalog = mcpCatalog(cli);
  return Command.make('mcp-serve', { harness }, (options) =>
    Effect.flatMap(
      CurrentInvocation,
      Effect.fnUntraced(function* (at: Invocation) {
        const row = cli.harness(options.harness);
        const key = (row.variable === undefined ? undefined : at.env[row.variable]?.trim()) || at.env[MCP_KEY_VARIABLE]?.trim();
        if (!key) {
          return refuse(
            'mcp-unsigned',
            row.variable === undefined
              ? `this ${row.harness} declaration carries no ${MCP_KEY_VARIABLE}, and ${row.harness} publishes no session id of its own, so this bridge has nothing to sign its calls with`
              : `neither ${row.variable} nor ${MCP_KEY_VARIABLE} stands in this bridge's environment, so it has nothing to sign its calls with`,
            [
              'tagma install — write the declaration, which mints the key this bridge signs with',
              'tagma upgrade — refresh a declaration written by an older Tagma',
            ],
          );
        }
        cli.declareBridge(at, { harness: row.harness, key });
        const shape = row.mcpTools;
        const bridge = crypto.randomUUID();
        const read = (after?: string) =>
          cli
            .ask((door) =>
              door.operations.perform({
                params: { id: 'read_capability_settings' },
                query: lens(at, {}),
                headers: {},
                payload: { after },
              }),
            )
            .pipe(
              Effect.retry({ while: (failure) => after !== undefined && unanswered(failure), schedule: AGAIN_AFTER_SILENCE }),
              Effect.flatMap(
                Schema.decodeUnknownEffect(Schema.Struct({ status: Schema.Literal('read'), ...CapabilitySettingsReading.fields })),
              ),
              Effect.mapError(
                (failure) =>
                  new McpServeFailed({
                    transport: 'stdio',
                    reason: `Capability settings could not be read: ${failure instanceof Error ? failure.message : String(failure)}`,
                  }),
              ),
            );
        let current = yield* read();
        let disabled = new Set(current.disabled);
        const changes = Stream.fromEffectRepeat(Effect.suspend(() => read(current.revision))).pipe(
          Stream.filter((next) => next.revision !== current.revision),
          Stream.tap((next) =>
            Effect.sync(() => {
              current = next;
              disabled = new Set(next.disabled);
            }),
          ),
        );
        return yield* serveMcpOverStdio({
          name: 'tagma',
          version: cli.version,
          tools: () => catalog.tools(shape, disabled),
          changes,
          call: (tool, input, meta, requestId, signal) => {
            const routed = catalog.route(shape, tool, input, disabled);
            if (routed._tag === 'Refused') return Promise.resolve(refused(routed.refusal, routed.json));
            if (routed._tag === 'Answer') return Promise.resolve({ text: routed.text ?? JSON.stringify(routed.value, null, 2) });
            return Effect.runPromise(
              performed(cli, at, routed.name, routed.input, routed.json, callKey(meta, row, bridge, requestId), routed.project).pipe(
                Effect.provideService(CallerSignal, signal),
              ),
            );
          },
        });
      }),
    ).pipe(Effect.provideService(Logger.LogToStderr, true)),
  ).pipe(
    Command.withDescription(
      'serve this Tagma’s operation catalog to a foreign CLI over MCP on stdin and stdout; tagma install writes the declaration that spawns it',
    ),
  );
};
