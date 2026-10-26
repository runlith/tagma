import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

const OLD = 'law-escaped';
const CURRENT = 'rule-escaped';
const OPEN = `<${OLD}>`;
const CLOSE = `</${OLD}>`;

const words = (value: unknown): unknown => (typeof value === 'string' ? value.replaceAll(`raises ${OLD}`, `raises ${CURRENT}`) : value);

const markup = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value.startsWith(OPEN) || !value.endsWith(CLOSE)) return value;
  return `<${CURRENT}>${words(value.slice(OPEN.length, -CLOSE.length))}</${CURRENT}>`;
};

export const ruleEscapedForm: ThreadFormStep = {
  name: '20261022021000_rule_escaped_signal',
  samples: {
    entry: { type: 'signal', signalType: OLD },
    message: { role: 'user', metadata: { origin: 'envelope' }, content: [{ type: 'text', text: `${OPEN}raises ${OLD}${CLOSE}` }] },
    inbox: { kind: 'signal', body: { type: OLD, text: `raises ${OLD}` } },
  },
  entry: (entry) => (entry.type === 'signal' && entry.signalType === OLD ? { ...entry, signalType: CURRENT } : null),
  message: (message) => {
    if (message.role !== 'user' || !Predicate.isObject(message.metadata) || message.metadata.origin !== 'envelope') return null;
    const held = message.content;
    if (!Array.isArray(held)) return null;
    const content = held.map((part: unknown) => {
      if (!Predicate.isObject(part) || Array.isArray(part) || part.type !== 'text') return part;
      const text = markup(part.text);
      return text === part.text ? part : { ...part, text };
    });
    return content.every((part, at) => part === held[at]) ? null : { ...message, content };
  },
  inbox: (item) => {
    if (item.kind !== 'signal' || !Predicate.isObject(item.body) || Array.isArray(item.body) || item.body.type !== OLD) return null;
    return { ...item, body: { ...item.body, type: CURRENT, text: words(item.body.text) } };
  },
};
