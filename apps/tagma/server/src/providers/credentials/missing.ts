import { AuthenticationReason, LLMError } from '@runlith/llm/schema/errors';

export function credentialMissing(message: string): LLMError {
  return new LLMError({
    module: 'Tagma',
    method: 'model',
    reason: new AuthenticationReason({ message, kind: 'missing' }),
  });
}
