import { describe, expect, test } from 'bun:test';
import {
  ANTHROPIC_PROVIDER,
  claudeCodeDescription,
  CLAUDE_CODE_PROVIDER,
  DEFAULT_ANTHROPIC_MODEL,
} from '@runlith/adapter-anthropic/models/anthropic';
import { SUBSCRIPTION_PROVIDER, subscriptionDescription } from '../subscription/description';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '../descriptions';
import {
  CODEX_PROVIDER,
  codexDescription,
  DEFAULT_CODEX_MODEL,
  DEFAULT_OPENAI_OAUTH_MODEL,
  openaiSubscriptionDescription,
  OPENAI_OAUTH_PROVIDER,
  OPENAI_PROVIDER,
} from '@runlith/adapter-openai/models/openai';
import { DEFAULT_XAI_MODEL, XAI_PROVIDER } from '@runlith/adapter-xai/models/xai';

const UNDECLARED_LIFETIME = { promisedSeconds: null, prior: null } as const;

const { resolveTextModel, supportsAdaptiveThinking } = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

describe('model catalog defaults', () => {
  test.each([
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-opus-4-5',
    'claude-fable-5',
  ])('retired OAuth selection %s is refused while the API model remains served', (model) => {
    expect(() => resolveTextModel(SUBSCRIPTION_PROVIDER, model)).toThrow(`Text model capacity is not configured for subscription/${model}`);
    expect(resolveTextModel(ANTHROPIC_PROVIDER, model).id).toBe(model);
  });
  test('every row declares its cache lifetime as the vendor promise and the measured prior kept apart', () => {
    expect(resolveTextModel(SUBSCRIPTION_PROVIDER, 'claude-opus-5-5').cacheLifetime).toEqual({
      promisedSeconds: 3_600,
      prior: null,
      reasoningKeyed: true,
    });
    expect(resolveTextModel(ANTHROPIC_PROVIDER, 'claude-opus-5').cacheLifetime).toEqual({
      promisedSeconds: 300,
      prior: null,
      reasoningKeyed: true,
    });
    const sol = resolveTextModel(OPENAI_OAUTH_PROVIDER, 'gpt-5.6-sol').cacheLifetime;
    expect(sol.promisedSeconds).toBeNull();
    expect(sol.prior?.buckets.find((bucket) => bucket.gap === '30–60m')).toEqual({
      gap: '30–60m',
      warmShare: 0.74,
      sample: 23,
    });
    expect(resolveTextModel(XAI_PROVIDER, 'grok-4.6').cacheLifetime).toEqual(UNDECLARED_LIFETIME);
  });

  test('resolves explicit provider defaults instead of catalog order', () => {
    expect(resolveTextModel('openai-oauth', null).id).toBe(DEFAULT_OPENAI_OAUTH_MODEL);
    expect(resolveTextModel('xai', null).id).toBe(DEFAULT_XAI_MODEL);
  });

  test('rejects a model id that belongs to another provider contract', () => {
    expect(() => resolveTextModel('openai-oauth', 'claude-sonnet-5')).toThrow(
      'Text model capacity is not configured for openai-oauth/claude-sonnet-5',
    );
  });

  test('a model id served by several providers carries the same label and short everywhere', () => {
    const byId = new Map<string, { provider: string; label: string; short: string }[]>();
    for (const provider of DEFAULT_PROVIDER_DESCRIPTIONS) {
      for (const [id, spec] of Object.entries(provider.models)) {
        const rows = byId.get(id) ?? [];
        rows.push({ provider: provider.id, label: spec.label, short: spec.short ?? spec.label });
        byId.set(id, rows);
      }
    }

    const disagreeing = [...byId.entries()]
      .filter(([, rows]) => rows.length > 1)
      .filter(([, rows]) => rows.some((row) => row.label !== rows[0]!.label || row.short !== rows[0]!.short));

    expect(disagreeing).toEqual([]);
    expect(byId.get('gpt-5.6-luna')?.length).toBeGreaterThan(1);
    expect(byId.get('grok-4.6')?.length).toBeGreaterThan(1);
  });

  test('exposes adaptive thinking on the served API and OAuth models', () => {
    expect(supportsAdaptiveThinking(ANTHROPIC_PROVIDER, 'claude-sonnet-4-6')).toBe(true);
    expect(supportsAdaptiveThinking(ANTHROPIC_PROVIDER, 'claude-opus-4-6')).toBe(true);
    for (const provider of [ANTHROPIC_PROVIDER, SUBSCRIPTION_PROVIDER] as const) {
      expect(supportsAdaptiveThinking(provider, 'claude-sonnet-5-5')).toBe(true);
    }
  });

  test('keeps GPT-6 Sol/Luna and GPT-5.6 API and OAuth capacities tied to their transport contracts', () => {
    for (const id of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
      const api = resolveTextModel(OPENAI_PROVIDER, id);
      const oauth = resolveTextModel(OPENAI_OAUTH_PROVIDER, id);

      expect(api.capacity).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 });
      expect(oauth.capacity).toEqual({ context: 872_000, input: 744_000, output: 128_000 });
      expect(api.reasoningOptions.map((option) => option.id)).toContain('max');
      expect(api.switches).toEqual([]);
      expect(oauth.reasoningOptions.map((option) => option.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(oauth.switches.map((option) => option.id)).toEqual(['serviceTier']);
      expect(oauth.switches[0]?.values.map((value) => value.id)).toEqual(['standard', 'priority']);
    }
  });

  test('Astra is a subscription row: the transport figures, its own tier, no console path', () => {
    const astra = resolveTextModel(OPENAI_OAUTH_PROVIDER, 'gpt-6-astra');

    expect(astra.capacity).toEqual({ context: 872_000, input: 744_000, output: 128_000 });
    expect(astra.reasoningOptions.map((option) => option.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(() => resolveTextModel(OPENAI_PROVIDER, 'gpt-6-astra')).toThrow('Text model capacity is not configured for openai/gpt-6-astra');
  });

  test('operator-only text rows require one inheritable same-provider spawn row', () => {
    const fable = {
      label: 'Fable',
      capacity: { context: 100_000 },
      capabilities: ['text'],
      reasoning: ['high'],
      defaultReasoning: 'high',
      operatorOnly: true,
    } as const;
    const opus = {
      label: 'Opus',
      capacity: { context: 100_000 },
      capabilities: ['text'],
      reasoning: ['high'],
      defaultReasoning: 'high',
    } as const;
    const description = {
      id: 'acme',
      label: 'Acme',
      auth: 'api-key',
      models: { fable, opus },
      cacheLifetime: UNDECLARED_LIFETIME,
      defaultTextModel: 'fable',
    } as const;

    expect(() => modelCatalog([description])).toThrow('Provider "acme" has operator-only text model "fable" but no spawnTextModel.');
    expect(() => modelCatalog([{ ...description, spawnTextModel: 'absent' }])).toThrow(
      'Provider "acme" spawnTextModel "absent" is absent or not a text model.',
    );
    expect(() => modelCatalog([{ ...description, spawnTextModel: 'fable' }])).toThrow(
      'Provider "acme" spawnTextModel "fable" is operator-only.',
    );
  });

  test('each subscription deployment keeps its Fable rows operator-only', () => {
    const subscriptions = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS.filter((provider) => provider.auth === 'oauth'));
    const operatorOnly = subscriptions.options.filter((option) => option.operatorOnly);

    expect(operatorOnly.map((option) => `${option.provider}/${option.id}`)).toEqual(['subscription/claude-fable-5-1']);
    expect(operatorOnly.every((option) => option.capabilities.includes('text'))).toBe(true);
  });

  test('spawn projections lower operator-only inheritance and reasoning without changing ordinary choices', () => {
    const catalog = modelCatalog([subscriptionDescription, claudeCodeDescription]);
    const fable = catalog.resolveTextModel(SUBSCRIPTION_PROVIDER, 'claude-fable-5-1');
    const opus = catalog.resolveTextModel(SUBSCRIPTION_PROVIDER, 'claude-opus-5-5');
    const haiku = catalog.resolveTextModel(CLAUDE_CODE_PROVIDER, 'claude-haiku-4-5');

    expect(catalog.spawnInherits(SUBSCRIPTION_PROVIDER, fable.id).id).toBe('claude-opus-5-5');
    expect(catalog.spawnInherits(SUBSCRIPTION_PROVIDER, opus.id)).toBe(opus);
    expect(catalog.spawnReasoning(opus, 'max', false)).toBe('xhigh');
    expect(catalog.spawnReasoning(opus, 'max', true)).toBe('max');
    expect(catalog.spawnReasoning(fable, 'max', true)).toBe('xhigh');
    expect(catalog.spawnReasoning(opus, 'high', false)).toBe('high');
    expect(catalog.spawnReasoning(haiku, null, false)).toBeNull();
  });

  test('a subset composition registers what the product supplied and refuses the rest by name', () => {
    const catalog = modelCatalog([subscriptionDescription]);
    expect(catalog.resolveTextModel(SUBSCRIPTION_PROVIDER, null).id).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(catalog.registered(OPENAI_PROVIDER)).toBe(false);
    expect(() => catalog.resolveTextModel(OPENAI_PROVIDER, null)).toThrow(
      'Unknown model provider "openai" — this catalog registers: subscription.',
    );
  });

  test('a provider this package never shipped registers the same way as the defaults', () => {
    const catalog = modelCatalog([
      {
        id: 'acme',
        label: 'Acme',
        auth: 'api-key',
        models: {
          'acme-1': {
            label: 'Acme 1',
            capacity: { context: 100_000, output: 8_000 },
            capabilities: ['text'],
            reasoning: ['low', 'high'],
            defaultReasoning: 'high',
            switches: [
              {
                id: 'batch',
                label: 'Batch',
                description: 'Deferred capacity',
                values: [{ id: 'on', label: 'On' }],
                default: null,
              },
            ],
          },
        },
        cacheLifetime: UNDECLARED_LIFETIME,
        defaultTextModel: 'acme-1',
      },
    ]);
    expect(catalog.resolveTextModel('acme', null)).toMatchObject({
      key: 'acme:acme-1',
      switches: [
        {
          id: 'batch',
          label: 'Batch',
          description: 'Deferred capacity',
          values: [{ id: 'on', label: 'On' }],
          default: null,
        },
      ],
    });
    expect(catalog.oauth('acme')).toBe(false);
    expect(catalog.providerOptions).toEqual([{ id: 'acme', label: 'Acme' }]);
  });

  test('the codex row and the subscription transport agree on every model they share', () => {
    const codex = new Map(Object.entries(codexDescription.models));
    const subscription = new Map(Object.entries(openaiSubscriptionDescription.models));
    const shared = [...codex.keys()].filter((id) => subscription.has(id));
    const ignored = new Set(['switches']);

    const disagreeing = shared.flatMap((id) => {
      const mine = codex.get(id)! as Record<string, unknown>;
      const theirs = subscription.get(id)! as Record<string, unknown>;
      return [...new Set([...Object.keys(mine), ...Object.keys(theirs)])]
        .filter((field) => !ignored.has(field))
        .filter((field) => JSON.stringify(mine[field]) !== JSON.stringify(theirs[field]))
        .map((field) => `${id}.${field}`);
    });

    expect(disagreeing).toEqual([]);
    expect(shared).toEqual([
      'gpt-6-astra',
      'gpt-6.1-sol',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ]);
  });

  test('a cli row serves a subset of its vendor, with the model’s own rungs and the switches its CLI takes', () => {
    const catalog = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

    expect(catalog.modelsOf(CLAUDE_CODE_PROVIDER).map((option) => option.id)).toEqual([
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-fable-5-1',
      'claude-sonnet-5-5',
      'claude-sonnet-5',
      'claude-haiku-5-5',
      'claude-haiku-4-5',
    ]);
    expect(() => catalog.resolveTextModel(CLAUDE_CODE_PROVIDER, 'claude-opus-4-5')).toThrow(
      'Text model capacity is not configured for claude-code/claude-opus-4-5',
    );

    expect(catalog.resolveTextModel(CLAUDE_CODE_PROVIDER, 'claude-haiku-4-5').reasoningOptions).toEqual([]);
    expect(catalog.resolveTextModel(CLAUDE_CODE_PROVIDER, 'claude-opus-5').reasoningOptions.map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(catalog.resolveTextModel(CODEX_PROVIDER, 'gpt-5.5').reasoningOptions.map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(catalog.resolveTextModel(CODEX_PROVIDER, DEFAULT_CODEX_MODEL).reasoningOptions.map((o) => o.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);

    for (const option of catalog.modelsOf(CODEX_PROVIDER)) expect(option.switches).toEqual([]);
    expect(catalog.resolveTextModel(CLAUDE_CODE_PROVIDER, 'claude-haiku-4-5').switches).toEqual([]);
    expect(catalog.resolveTextModel(CLAUDE_CODE_PROVIDER, 'claude-opus-5-5').switches).toEqual(
      catalog.resolveTextModel(SUBSCRIPTION_PROVIDER, 'claude-opus-5-5').switches,
    );
    expect(catalog.resolveTextModel(SUBSCRIPTION_PROVIDER, 'claude-opus-5-5').switches).not.toEqual([]);
    expect(catalog.resolveTextModel(OPENAI_OAUTH_PROVIDER, DEFAULT_CODEX_MODEL).switches).not.toEqual([]);
  });

  test('the older OAuth model carries its own Codex transport ceiling and its own shorter ladder', () => {
    expect(resolveTextModel(OPENAI_OAUTH_PROVIDER, 'gpt-5.5').capacity).toEqual({
      context: 272_000,
      input: 144_000,
      output: 128_000,
    });
    expect(resolveTextModel(OPENAI_OAUTH_PROVIDER, 'gpt-5.5').reasoningOptions.map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });
});
