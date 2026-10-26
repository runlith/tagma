import { type MediaPart, Message, type TextPart } from '@runlith/llm/schema/messages';
import { Schema } from 'effect';
import { type AgentSignal, type AgentSignalPart, isReaderWords } from './contracts';
import { skillReferences } from './skillReferences';
import { clockFigure, tokensFigure } from './figures';

const XML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export const AGENT_MESSAGE_ORIGINS = ['orientation', 'guidance', 'envelope', 'summary'] as const;
export type AgentMessageOrigin = (typeof AGENT_MESSAGE_ORIGINS)[number];

const ORIGIN_KEY = 'origin';

export function withAgentOrigin(message: Message, origin: AgentMessageOrigin): Message {
  return Message.make({ ...message, metadata: { ...message.metadata, [ORIGIN_KEY]: origin } });
}

export function agentOriginOf(message: Message): AgentMessageOrigin | undefined {
  const marked = message.metadata?.[ORIGIN_KEY];
  return AGENT_MESSAGE_ORIGINS.find((origin) => origin === marked);
}

const INPUT_KEY = 'readerInput';

export function withAgentReaderInput(message: Message, id: string, position?: number): Message {
  return Message.make({
    ...message,
    metadata: { ...message.metadata, [INPUT_KEY]: id, readerPosition: position ?? message.metadata?.readerPosition },
  });
}

export function agentReaderPosition(message: Message): number | undefined {
  const position = message.metadata?.readerPosition;
  return typeof position === 'number' && Number.isSafeInteger(position) && position > 0 ? position : undefined;
}

export function agentReaderInput(message: Message): string | undefined {
  const marked = message.metadata?.[INPUT_KEY];
  return typeof marked === 'string' && marked.length > 0 ? marked : undefined;
}

export type ReaderMark = { readonly input: string; readonly position: number | null };

export function latestReaderMark(messages: readonly Message[]): ReaderMark | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const input = agentReaderInput(message);
    if (input !== undefined) return { input, position: agentReaderPosition(message) ?? null };
  }
  return null;
}

export function agentSignalMessage(signal: AgentSignal, attached?: readonly AgentSignalPart[]): Message {
  const markup = agentSignalMarkup(signal);
  const message = withAgentOrigin(
    Message.user(attached?.length ? [{ type: 'text' as const, text: markup }, ...attached.map(contentPart)] : markup),
    'envelope',
  );
  return isReaderWords(signal)
    ? withAgentReaderInput(withAgentInputSkills(message, requestedSkills(signal.text)), signal.id, signal.readerPosition)
    : message;
}

function contentPart(part: AgentSignalPart): MediaPart | TextPart {
  if (part.type === 'text') return { type: 'text', text: part.text };
  return {
    type: 'media',
    mediaType: part.mediaType,
    data: part.data,
    filename: part.filename,
  };
}

const inputSkills = new WeakMap<Message, ReadonlySet<string> | null>();
const hasInputSkills = Schema.is(Schema.Struct({ readerSkills: Schema.Array(Schema.String) }));

function requestedSkills(text: string): ReadonlySet<string> {
  return new Set(skillReferences(text).map((reference) => reference.id));
}

export function agentInputSkills(message: Message): ReadonlySet<string> | null {
  if (message.role !== 'user') return null;
  const known = inputSkills.get(message);
  if (known !== undefined) return known;
  const origin = agentOriginOf(message);
  const skills =
    origin === undefined
      ? requestedSkills(message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'))
      : (origin === 'envelope' || origin === 'summary') && hasInputSkills(message.metadata)
        ? new Set(message.metadata.readerSkills)
        : null;
  inputSkills.set(message, skills);
  return skills;
}

export function withAgentInputSkills(message: Message, skills: ReadonlySet<string>): Message {
  return Message.make({ ...message, metadata: { ...message.metadata, readerSkills: [...skills] } });
}

export function agentSignalMarkup(
  signal: Pick<AgentSignal, 'type' | 'text' | 'from' | 'senderThreadId' | 'envelopeId' | 'context'>,
): string {
  if (!XML_NAME_PATTERN.test(signal.type)) throw new Error(`Invalid agent signal type: ${signal.type}`);
  const context = signal.context;
  const attributes = [
    signal.from === undefined ? '' : ` from="${escapeXmlAttribute(signal.from)}"`,
    signal.senderThreadId === undefined ? '' : ` thread="${escapeXmlAttribute(signal.senderThreadId)}"`,
    signal.envelopeId === undefined ? '' : ` envelope="${escapeXmlAttribute(signal.envelopeId)}"`,
    context === undefined ? '' : ` context="${tokensFigure(context.tokens)}"`,
    context?.warmUntil === undefined ? '' : ` warm-until="${clockFigure(context.warmUntil)}"`,
  ].join('');
  return `<${signal.type}${attributes}>${escapeXml(signal.text)}</${signal.type}>`;
}

export const AGENT_RUNTIME_GUIDANCE_SIGNAL_TYPE = 'runtime-guidance';

export function agentRuntimeGuidanceMessage(text: string, state?: Readonly<Record<string, unknown>>, retell?: false): Message {
  const metadata = { ...(state === undefined ? {} : { runtimeState: state }), ...(retell === false ? { retell } : {}) };
  return withAgentOrigin(
    new Message({
      ...Message.user(agentSignalMarkup({ type: AGENT_RUNTIME_GUIDANCE_SIGNAL_TYPE, text })),
      metadata: Object.keys(metadata).length === 0 ? undefined : metadata,
    }),
    'guidance',
  );
}

export function opensTurnMessage(message: Message): boolean {
  if (message.role !== 'user') return false;
  const origin = agentOriginOf(message);
  return origin === undefined || origin === 'envelope';
}

export function agentRetold(message: Message): boolean {
  return message.metadata?.retell !== false;
}

export function trailingReaderInputs(messages: readonly Message[]): readonly string[] {
  const inputs: string[] = [];
  for (let index = messages.length - 1; index >= 0 && messages[index]!.role === 'user'; index -= 1) {
    const input = agentReaderInput(messages[index]!);
    if (input !== undefined) inputs.unshift(input);
  }
  return inputs;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXmlAttribute(value: string): string {
  return escapeXml(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
