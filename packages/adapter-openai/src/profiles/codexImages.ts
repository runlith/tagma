import { Effect, Schema } from 'effect';
import type * as Auth from '@runlith/llm/route/auth';
import { generateImages } from '@runlith/llm/protocols/openai-images';
import type { ImageModelSpec } from '@runlith/llm/models/description';
import { checkedImageRequest, type ImageAnswer, type ImageRequest } from '@runlith/llm/profiles/images';
import { LLMError, QuotaExceededReason } from '@runlith/llm/schema/errors';

export type CodexImagesForm = {
  readonly client: string;
  readonly model: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

export type ImagesRoute = {
  readonly baseURL: string;
  readonly auth: Auth.Auth;
  readonly recover: Effect.Effect<void, LLMError> | undefined;
};

const UsageLimit = Schema.Struct({ error: Schema.Struct({ resets_at: Schema.optional(Schema.Number) }) });
const decodeUsageLimit = Schema.decodeUnknownOption(Schema.fromJsonString(UsageLimit));

const resetOf = (reason: QuotaExceededReason): number | undefined => {
  const body = reason.http?.body;
  const named = body === undefined ? undefined : decodeUsageLimit(body);
  if (named !== undefined && named._tag === 'Some' && named.value.error.resets_at !== undefined) return named.value.error.resets_at;
  const header = Number(reason.http?.response?.headers['x-codex-primary-reset-at']);
  return Number.isFinite(header) && header > 0 ? header : undefined;
};

const withReset = (error: LLMError): LLMError => {
  if (error.reason._tag !== 'QuotaExceeded' || error.reason.resetsAt !== undefined) return error;
  const resetsAt = resetOf(error.reason);
  return resetsAt === undefined ? error : new LLMError({ ...error, reason: new QuotaExceededReason({ ...error.reason, resetsAt }) });
};

export const codexImages = (form: CodexImagesForm) =>
  Effect.fn('codexImages.generate')(
    function* (spec: ImageModelSpec, route: ImagesRoute, request: ImageRequest) {
      yield* checkedImageRequest(spec, request);
      const reply = yield* generateImages(
        { baseURL: route.baseURL, auth: route.auth, recover: route.recover, fields: form.fields },
        request,
      );
      return { images: reply.images, requestId: reply.requestId, headers: reply.headers } satisfies ImageAnswer;
    },
    (effect) => Effect.mapError(effect, withReset),
  );
