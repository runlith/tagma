import { Effect, Layer } from 'effect';
import { claudeCode } from '@runlith/adapter-anthropic/harness';
import { gemini } from '@runlith/adapter-google/harness';
import { codex } from '@runlith/adapter-openai/harness';
import { devin } from '@runlith/adapter-devin/harness';
import { cursor } from '@runlith/adapter-cursor/adapter';
import { opencode } from '@runlith/adapter-opencode/harness';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { SessionIdentity } from '../../platform/contract/wire/session.js';
import { declaredHarness } from '../adapter/declared.js';
import { makeHarnessAdapters } from '../adapters.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import { sessionIdentityOf } from '../sessionPrefix.js';
import { BUILTIN_HARNESSES } from '../vendors/builtin.js';

export const SHIPPED_PROVIDERS: readonly HarnessProvider[] = [claudeCode, codex, gemini, opencode, devin, cursor];

export const SHIPPED_HARNESSES: readonly HarnessAdapter[] = [
  declaredHarness(claudeCode)!,
  declaredHarness(codex)!,
  ...BUILTIN_HARNESSES,
  declaredHarness(gemini)!,
  declaredHarness(opencode)!,
  declaredHarness(devin)!,
  declaredHarness(cursor)!,
];

export const builtinHarness = (id: string): HarnessAdapter => {
  const row = SHIPPED_HARNESSES.find((one) => one.harness === id);
  if (row === undefined) throw new Error(`no builtin harness ${id}`);
  return row;
};

export const shippedHarnessAdapters = Effect.tap(makeHarnessAdapters, (adapters) => adapters.declared(SHIPPED_PROVIDERS));

export const shippedHarnessAdaptersLayer = Layer.effect(HarnessAdapters, shippedHarnessAdapters);

export const sessionIdentity: SessionIdentity['Service'] = sessionIdentityOf(SHIPPED_HARNESSES);

export const sessionIdentityLayer: Layer.Layer<SessionIdentity> = Layer.succeed(SessionIdentity, sessionIdentity);
