import { Schema } from 'effect';
import type { CheckoutWorld } from '../../../executions/contract/wire/world.js';
import { COMMAND_DESCRIPTIONS, DEFAULT_COMMAND_DESCRIPTION, type CommandDescription } from '@runlith/agent-tools/workspace';
import {
  settingKey,
  settingListKey,
  SETTABLE_SCOPES,
  type SettingDeclaration,
  type SettingId,
} from '../../../platform/contract/wire/setting.js';

type NativeId = SettingId<'agent' | 'skills'>;

export function nativeKey<A, const Id extends NativeId>(declaration: SettingDeclaration<A> & { readonly id: Id }) {
  return settingKey(declaration);
}

export function nativeListKey<M, const Id extends NativeId>(
  declaration: Omit<SettingDeclaration<readonly M[]>, 'schema' | 'member'> & {
    readonly id: Id;
    readonly member: Schema.Codec<M, unknown>;
  },
) {
  return settingListKey(declaration);
}

export const keepWarm = nativeKey({
  id: 'agent.keepWarm',
  order: 570,
  title: 'Keep a waiting thread warm',
  description:
    "Whether a thread at rest that waits on its children, its commands or its background calls is pinged shortly before its prompt cache expires, so their reports and endings wake it warm instead of rewriting its whole context. A ping requires a warm context reading with an evidenced cache lifetime and spendable quota. A ping is a short turn on the thread's own model and account, answered with ok, and it shows in the thread's feed.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
  operatorOnly: true,
});

export const keepWarmPings = nativeKey({
  id: 'agent.keepWarmPings',
  order: 580,
  title: 'Keep-warm pings per wait',
  description:
    'How many pings one wait may spend. A wait runs from the thread coming to rest until it runs again for any other reason; its pings are counted from the thread’s own record, so a restart keeps the count.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  control: { kind: 'number', minimum: 1, step: 1, unit: 'pings' },
  fallback: 3,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
  operatorOnly: true,
});

export const commandDescription = nativeKey({
  id: 'agent.commandDescription',
  order: 585,
  title: 'Command descriptions',
  description:
    'Whether bash asks the model for a description. Calls without one run under the command head. Changes take effect when a run opens.',
  schema: Schema.Literals(COMMAND_DESCRIPTIONS),
  control: {
    kind: 'choice',
    choices: [
      { value: 'required', label: 'Required', hint: 'The model sees description as a required argument.' },
      { value: 'optional', label: 'Optional', hint: 'The model may leave description out.' },
    ],
  },
  fallback: DEFAULT_COMMAND_DESCRIPTION as CommandDescription,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const TOOL_OUTPUT_SHARE = {
  minimum: 0.01,
  maximum: 0.9,
} as const;

export const toolOutputShare = nativeKey({
  id: 'agent.toolOutputShare',
  order: 590,
  title: 'Tool output share',
  description:
    "The share of a model request's input ceiling kept as the newest tool output; lowering it on a live thread can prune inside the warm prefix and invalidate its prompt cache.",
  schema: Schema.Number.check(Schema.isBetween({ minimum: TOOL_OUTPUT_SHARE.minimum, maximum: TOOL_OUTPUT_SHARE.maximum })),
  control: {
    kind: 'share',
    minimum: TOOL_OUTPUT_SHARE.minimum,
    maximum: TOOL_OUTPUT_SHARE.maximum,
    reference: { ceiling: 200_000, of: 'input ceiling' },
  },
  fallback: 0.2,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const START_SHARE = {
  minimum: 0.01,
  maximum: 0.5,
} as const;

export const startShare = nativeKey({
  id: 'agent.startShare',
  order: 595,
  title: 'Costly start',
  description:
    "The share of a thread's model context window its start may take before the thread the operator opened shows what the start is made of. Compared in characters at the provider's measured characters per token.",
  schema: Schema.Number.check(Schema.isBetween({ minimum: START_SHARE.minimum, maximum: START_SHARE.maximum })),
  control: {
    kind: 'share',
    minimum: START_SHARE.minimum,
    maximum: START_SHARE.maximum,
    reference: { ceiling: 200_000, of: 'context window' },
  },
  fallback: 0.1,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const CHECKOUT_WORLDS = ['platform', 'managed'] as const satisfies readonly CheckoutWorld[];

export const checkoutWorld = nativeKey({
  id: 'agent.checkoutWorld',
  order: 650,
  title: 'Checkout world',
  description: 'Which substrate runs a checkout thread’s commands: this process, or the managed execution host.',
  schema: Schema.Literals(CHECKOUT_WORLDS),
  control: {
    kind: 'choice',
    choices: [
      {
        value: 'platform',
        label: 'Platform',
        hint: 'Opt out: commands spawn on this machine, exactly as they always have; a standing host changes nothing.',
      },
      {
        value: 'managed',
        label: 'Managed',
        hint: 'The default: where a host stands, commands run as its executions and appear in its inventory; where none stands, the platform world serves. A managed failure never falls back.',
      },
    ],
  },
  fallback: 'managed' as CheckoutWorld,
  scopes: ['user'],
  merge: 'replace',
});
