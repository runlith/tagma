import { Schema } from 'effect';
import { decode, simctl, SimulatorUnavailable, type Device } from './device.ts';
import type { Tools } from './iosTools.ts';

export const ButtonType = 9;
export const DisabledTrait = 0x100;
const BridgeScalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
type BridgeScalar = typeof BridgeScalar.Type;
const BridgeFrame = Schema.Struct({
  X: Schema.optional(Schema.Number),
  Y: Schema.optional(Schema.Number),
  Width: Schema.optional(Schema.Number),
  Height: Schema.optional(Schema.Number),
});
export const PositionedFrame = Schema.Struct({
  X: Schema.Finite,
  Y: Schema.Finite,
  Width: Schema.Finite.check(Schema.isGreaterThan(0)),
  Height: Schema.Finite.check(Schema.isGreaterThan(0)),
});
type BridgeNode = {
  readonly XC_kAXXCAttributeElementType?: BridgeScalar | null;
  readonly XC_kAXXCAttributeAutomationType?: BridgeScalar | null;
  readonly XC_kAXXCAttributeTraits?: number | null;
  readonly XC_kAXXCAttributeIdentifier?: BridgeScalar | null;
  readonly XC_kAXXCAttributeLabel?: BridgeScalar | null;
  readonly XC_kAXXCAttributeFrame?: typeof BridgeFrame.Type | null;
  readonly XC_kAXXCAttributeChildren?: readonly BridgeNode[] | null;
};
const BridgeNode: Schema.Codec<BridgeNode> = Schema.suspend(() =>
  Schema.Struct({
    XC_kAXXCAttributeElementType: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeAutomationType: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeTraits: Schema.optional(Schema.NullOr(Schema.Number)),
    XC_kAXXCAttributeIdentifier: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeLabel: Schema.optional(Schema.NullOr(BridgeScalar)),
    XC_kAXXCAttributeFrame: Schema.optional(Schema.NullOr(BridgeFrame)),
    XC_kAXXCAttributeChildren: Schema.optional(Schema.NullOr(Schema.Array(BridgeNode))),
  }),
);
const BridgeReply = Schema.Union([
  Schema.Struct({ tree: Schema.Struct({ response: Schema.Struct({ tree: BridgeNode }) }) }),
  Schema.Struct({ failure: Schema.Struct({ reason: Schema.Struct({ error: Schema.String }) }) }),
]);
type AXRead = {
  readonly pid: number;
  readonly automation: boolean;
  readonly depth: number;
  readonly nodes: number;
  readonly traversal: 'view-hierarchy' | 'single-fetch';
};
export const readAX = async (device: Device, tools: Tools, input: AXRead): Promise<BridgeNode> => {
  const raw = await simctl(
    device.set,
    'spawn',
    device.udid,
    tools.bridge,
    'accessibility',
    'describe',
    '--pid',
    String(input.pid),
    '--max-depth',
    String(input.depth),
    '--max-nodes',
    String(input.nodes),
    '--traversal',
    input.traversal,
    '--client-type',
    '0',
    '--automation-mode',
    String(input.automation),
  );
  const reply = decode(BridgeReply, JSON.parse(raw));
  if ('failure' in reply) throw new SimulatorUnavailable({ message: reply.failure.reason.error });
  return reply.tree.response.tree;
};
export const elementsOf = (root: BridgeNode): BridgeNode[] => {
  const elements = [root];
  for (let index = 0; index < elements.length; index++) elements.push(...(elements[index]!.XC_kAXXCAttributeChildren ?? []));
  return elements;
};
