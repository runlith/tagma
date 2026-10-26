import { Message } from '@runlith/llm/schema/messages';
import type { ThreadCalibrationBaseline } from '../calibration';
import { estimateThreadTokens } from '../measurement';

export type CorpusFixture = {
  readonly id: string;
  readonly measures: string;
  readonly request: { system?: string; messages: readonly Message[]; tools?: readonly unknown[] };
};

const prose = (words: number, word: string) => Array.from({ length: words }, () => word).join(' ');

const toolSchema = (name: string) => ({
  name,
  description: `Operate on ${name} and answer with what changed.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file this acts on.' },
      pattern: { type: 'string', description: 'What to match inside it.' },
      limit: { type: 'number', description: 'How many answers at most.' },
    },
    required: ['path'],
  },
});

export const CONTEXT_CORPUS: readonly CorpusFixture[] = [
  {
    id: 'prose-english',
    measures: 'ordinary prose, the shape the four-character ratio was derived from',
    request: { system: 'You are a careful assistant.', messages: [Message.user(prose(400, 'consider'))] },
  },
  {
    id: 'prose-cyrillic',
    measures: 'a script whose characters carry fewer tokens each than Latin prose',
    request: { messages: [Message.user(prose(400, 'рассмотрим'))] },
  },
  {
    id: 'tool-schemas',
    measures: 'JSON schema bodies, which tokenize far worse per character than prose',
    request: {
      messages: [Message.user('Use the tools.')],
      tools: ['read', 'grep', 'glob', 'edit', 'bash'].map(toolSchema),
    },
  },
  {
    id: 'tool-output',
    measures: 'a large tool result, which is most of an agent thread by volume',
    request: { messages: [Message.user('```\n' + prose(2_000, 'line') + '\n```')] },
  },
  {
    id: 'structured-data',
    measures: 'dense JSON, where punctuation dominates the character count',
    request: { messages: [Message.user(JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, ok: true }))))] },
  },
  {
    id: 'post-compaction',
    measures: 'a folded history: a summary head followed by a retained tail',
    request: {
      messages: [Message.assistant('## Objective\n- ' + prose(120, 'carried')), Message.user(prose(60, 'next'))],
    },
  },
];

export type CorpusMeasurement = {
  readonly fixtureId: string;
  readonly provider: string;
  readonly model: string;
  readonly reportedInputTokens: number;
};

export function baselineWeight(
  measurements: readonly CorpusMeasurement[],
  estimate: (fixture: CorpusFixture) => number,
): number | undefined {
  let reported = 0;
  let estimated = 0;
  for (const measurement of measurements) {
    const fixture = CONTEXT_CORPUS.find((item) => item.id === measurement.fixtureId);
    if (!fixture) continue;
    const predicted = estimate(fixture);
    if (predicted <= 0) continue;
    reported += measurement.reportedInputTokens;
    estimated += predicted;
  }
  if (estimated <= 0) return undefined;
  return Math.max(0.5, Math.min(reported / estimated, 2));
}

export const CORPUS_MEASUREMENTS: readonly CorpusMeasurement[] = [];

export function corpusBaseline(measurements: readonly CorpusMeasurement[] = CORPUS_MEASUREMENTS): ThreadCalibrationBaseline {
  const byPair = new Map<string, CorpusMeasurement[]>();
  for (const measurement of measurements) {
    const key = pairKey(measurement.provider, measurement.model);
    const held = byPair.get(key);
    if (held) held.push(measurement);
    else byPair.set(key, [measurement]);
  }
  const weights = new Map<string, number | undefined>();
  return (provider, model) => {
    const key = pairKey(provider, model);
    if (!weights.has(key)) {
      const measured = byPair.get(key);
      weights.set(key, measured === undefined ? undefined : baselineWeight(measured, (fixture) => estimateThreadTokens(fixture.request)));
    }
    return weights.get(key);
  };
}

const pairKey = (provider: string, model: string | null): string => `${provider}/${model ?? ''}`;
