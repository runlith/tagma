import { CLAUDE_SESSION } from '@runlith/adapter-anthropic/harness/session';
import { GROK_SESSION } from '@runlith/adapter-xai/harness/session';
import type { Signer } from '../../cli/contract/service/server.js';
import { SESSION_SIGNERS } from '../../external-harnesses/contract/wire/sessionVariables.js';

export const SIGNERS: readonly Signer[] = [CLAUDE_SESSION, ...SESSION_SIGNERS, GROK_SESSION];
