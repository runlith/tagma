import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { DecisionRequest } from '@runlith/llm/decision';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { HttpExecutor } from '@runlith/llm/route/executor';
import { Effect } from 'effect';
import { HttpClient, type HttpClientRequest, HttpClientResponse } from 'effect/http';
import { adapter } from './adapter';

const credentials: ModelCredentials = {
  apiKey: async () => 'sk-or-fixture',
  accessToken: async () => {
    throw new Error('OpenRouter signs with a key');
  },
  credential: async () => {
    throw new Error('OpenRouter signs with a key');
  },
};

const [provider] = adapter({ product: { mcpServer: 'tagma', client: { name: 'tagma', version: '0' } }, instances: [] });

const TRIAGE: DecisionRequest = {
  state: { report: 'Checkout fails for every card since the last deploy.' },
  instructions: 'Triage a support report.',
  questions: {
    is_bug: { type: 'noul', instructions: 'Is this a bug report?', criteria: { true: 'Something broke.', false: 'A question.' } },
    team: { type: 'choice', instructions: 'Which team owns it?', criteria: { payments: 'Charges.', frontend: 'Pages.', account: null } },
    urgency: { type: 'score', criteria: ['Can wait', 'This week', 'Now'] },
  },
};

const REPLY = {
  id: 'gen-dec-1',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  answers: {
    is_bug: { type: 'noul', noul: 0.96 },
    team: { type: 'choice', choice: 'payments', confidence: 0.67, probabilities: { payments: 0.78, frontend: 0.22, account: 0 } },
    urgency: { type: 'score', score: 1.99, confidence: 0.99, probabilities: { '0': 0, '1': 0, '2': 1 }, legend: { '0': 'Can wait' } },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.00002 },
};

const replying = (reply: unknown, sent: HttpClientRequest.HttpClientRequest[]) =>
  HttpExecutor.of({
    execute: (request) =>
      Effect.sync(() => {
        sent.push(request);
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } }),
        );
      }),
  });

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === 'Uint8Array' ? JSON.parse(new TextDecoder().decode(request.body.body)) : null;

it.effect('a decision model answers in the contract form with the probabilities it computed', () =>
  Effect.gen(function* () {
    if (provider?.kind !== 'wire' || provider.decisions === undefined) return yield* Effect.die('OpenRouter declares no decision profile');
    const sent: HttpClientRequest.HttpClientRequest[] = [];
    const answer = yield* provider.decisions
      .decide({ ownerId: 'operator', model: 'typesafe/jev-1.13', credentials }, TRIAGE)
      .pipe(Effect.provideService(HttpExecutor, replying(REPLY, sent)));
    expect(answer.answers).toEqual({
      is_bug: { type: 'noul', noul: true, probability: 0.96 },
      team: { type: 'choice', choice: 'payments', probabilities: { payments: 0.78, frontend: 0.22, account: 0 }, confidence: 0.67 },
      urgency: { type: 'score', score: 1.99, probabilities: { '0': 0, '1': 0, '2': 1 }, confidence: 0.99 },
    });
    expect(answer.model).toMatchObject({ provider: 'openrouter', model: 'typesafe/jev-1.13' });
    expect(answer.usage).toMatchObject({ inputTokens: 476, outputTokens: 70 });
    expect(sent[0]?.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(sent[0]?.headers.authorization).toBe('Bearer sk-or-fixture');
    expect(bodyOf(sent[0]!)).toEqual({
      model: 'typesafe/jev-1.13',
      state: TRIAGE.state,
      questions: {
        is_bug: {
          type: 'noul',
          instructions: 'Triage a support report.\n\nIs this a bug report?',
          criteria: { true: 'Something broke.', false: 'A question.' },
        },
        team: {
          type: 'choice',
          instructions: 'Triage a support report.\n\nWhich team owns it?',
          criteria: { payments: 'Charges.', frontend: 'Pages.', account: null },
        },
        urgency: { type: 'score', instructions: 'Triage a support report.', criteria: ['Can wait', 'This week', 'Now'] },
      },
    });
  }),
);

it.effect('an answer of another type than asked is refused as malformed', () =>
  Effect.gen(function* () {
    if (provider?.kind !== 'wire' || provider.decisions === undefined) return yield* Effect.die('OpenRouter declares no decision profile');
    const refused = yield* provider.decisions
      .decide({ ownerId: 'operator', model: 'typesafe/jev-1.13', credentials }, TRIAGE)
      .pipe(
        Effect.provideService(HttpExecutor, replying({ ...REPLY, answers: { ...REPLY.answers, is_bug: { type: 'score', score: 1 } } }, [])),
        Effect.flip,
      );
    expect(refused).toMatchObject({ _tag: 'DecisionRefused', reason: 'malformed' });
  }),
);

it.effect('the catalog lists the decision models of OpenRouter as decision models', () =>
  Effect.gen(function* () {
    if (provider?.kind !== 'wire' || provider.catalog === undefined) return yield* Effect.die('OpenRouter declares no catalog');
    const asked: string[] = [];
    const listing = {
      data: [
        { id: 'typesafe/jev-1.13', name: 'TypeSafe: Jev 1.13', context_length: 131072 },
        { id: 'baseten/elephant-1:free', name: 'Baseten: Elephant 1 (free)', context_length: 16384 },
      ],
    };
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        asked.push(request.url);
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(listing)));
      }),
    );
    const read = yield* provider.catalog.read(credentials, 'operator').pipe(Effect.provideService(HttpClient.HttpClient, client));
    expect(asked).toEqual(['https://openrouter.ai/api/v1/models?output_modalities=decisions']);
    expect(read.defaultTextModel).toBe('');
    expect(read.models['typesafe/jev-1.13']).toMatchObject({
      label: 'TypeSafe: Jev 1.13',
      capacity: { context: 131072 },
      capabilities: ['decision'],
    });
    expect(Object.keys(read.models)).toEqual(['typesafe/jev-1.13', 'baseten/elephant-1:free']);
  }),
);
