import { CLAUDE_SESSION } from '@runlith/adapter-anthropic/harness/session';
import { CODEX_SESSION } from '@runlith/adapter-openai/harness/session';
import { GROK_SESSION } from '@runlith/adapter-xai/harness/session';
import { OPENCODE_SESSION } from '@runlith/adapter-opencode/harness/session';
import type { Signer } from '../../cli/contract/service/server.js';

export const SIGNERS: readonly Signer[] = [CLAUDE_SESSION, CODEX_SESSION, OPENCODE_SESSION, GROK_SESSION];
