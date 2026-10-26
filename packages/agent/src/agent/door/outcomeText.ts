import type { StructuredValue } from '@runlith/utils/object';
import { refusalLines } from '../../tool/refusal';
import { type Tool, documentAsked } from '../tool';
import { type AgentToolModelOutput, doorToolModelOutput } from '../ToolOutput';

const factLines = (facts: Readonly<Record<string, unknown>>, said: string | undefined): string[] =>
  Object.entries(facts).flatMap(([key, value]) => {
    if (value === null || value === undefined) return [];
    if (key === 'output' && said !== undefined) return ['output:', ...said.split('\n').map((line) => `  ${line}`)];
    return [`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`];
  });

export const outcomeLines = (outcome: StructuredValue | undefined, said?: string): string[] => {
  if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) return [JSON.stringify(outcome ?? null)];
  const { status, code, reason, unblock, ...facts } = outcome as Readonly<Record<string, unknown>>;
  if (status === 'refused' && typeof code === 'string' && typeof reason === 'string') {
    const ways = Array.isArray(unblock) ? unblock.filter((way): way is string => typeof way === 'string') : [];
    return [...refusalLines({ code, reason, unblock: ways }), ...factLines(facts, said)];
  }
  return Object.entries(outcome).flatMap(([key, value]) => {
    if (key === 'status') return [typeof reason === 'string' ? `${String(status)}: ${reason}` : String(status)];
    return key === 'reason' ? [] : factLines({ [key]: value }, said);
  });
};

export const doorOutput = (
  tool: Tool | undefined,
  rawInput: unknown,
  document: StructuredValue | undefined,
  text: () => string,
): AgentToolModelOutput => (documentAsked(tool, rawInput) ? doorToolModelOutput(document) : { type: 'text', value: text() });

export const outcomeOutput = (tool: Tool, rawInput: unknown, outcome: StructuredValue | undefined, said?: string): AgentToolModelOutput =>
  doorOutput(tool, rawInput, outcome, () => outcomeLines(outcome, said).join('\n'));
