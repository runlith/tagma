import { z } from 'zod';
import { parseWindowBehaviorPatch, type WindowBehaviorPatch, type WindowFocusPolicy, windowFocusPolicySchema } from './state.js';

const applyPatchCommandSchema = z.object({
  type: z.literal('apply-patch'),
  patch: z.unknown().transform((value) => parseWindowBehaviorPatch(value)),
});

const setBooleanCommand = <TType extends string>(type: TType) =>
  z.object({
    type: z.literal(type),
    value: z.boolean(),
  });

const setNumberCommand = <TType extends string>(type: TType) =>
  z.object({
    type: z.literal(type),
    value: z.number(),
  });

const setFocusPolicyCommandSchema = z.object({
  type: z.literal('set-focus-policy'),
  value: windowFocusPolicySchema,
});

const setPointerInteractiveCommandSchema = z.object({
  type: z.literal('set-pointer-interactive'),
  interactive: z.boolean(),
  forward: z.boolean().optional(),
});

const triggerCommandSchema = <TType extends string>(type: TType) =>
  z.object({
    type: z.literal(type),
  });

export const windowBehaviorCommandSchema = z.discriminatedUnion('type', [
  setBooleanCommand('set-always-on-top'),
  setBooleanCommand('set-transparent'),
  setNumberCommand('set-window-opacity'),
  setBooleanCommand('set-overlay-background-visible'),
  setNumberCommand('set-overlay-background-opacity'),
  setBooleanCommand('set-pass-through'),
  setFocusPolicyCommandSchema,
  setBooleanCommand('set-capture-protection'),
  setPointerInteractiveCommandSchema,
  triggerCommandSchema('request-interactive-focus'),
  triggerCommandSchema('release-interactive-focus'),
  applyPatchCommandSchema,
]);

export type WindowBehaviorCommand =
  | { type: 'set-always-on-top'; value: boolean }
  | { type: 'set-transparent'; value: boolean }
  | { type: 'set-window-opacity'; value: number }
  | { type: 'set-overlay-background-visible'; value: boolean }
  | { type: 'set-overlay-background-opacity'; value: number }
  | { type: 'set-pass-through'; value: boolean }
  | { type: 'set-focus-policy'; value: WindowFocusPolicy }
  | { type: 'set-capture-protection'; value: boolean }
  | { type: 'set-pointer-interactive'; interactive: boolean; forward?: boolean }
  | { type: 'request-interactive-focus' }
  | { type: 'release-interactive-focus' }
  | { type: 'apply-patch'; patch: WindowBehaviorPatch };

export function parseWindowBehaviorCommand(input: unknown): WindowBehaviorCommand {
  return windowBehaviorCommandSchema.parse(input);
}
