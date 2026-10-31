import { Data, Effect, Schema } from 'effect';
import { ToolResultPart, type Message } from '@runlith/llm/schema/messages';
import { type AgentRule, agentRule } from './policy/AgentRuntimePolicy';
import { type ToolCatalog, mergeToolCatalogs } from './ToolCatalog';
import { ToolAnswer, ToolFailed, Tool } from './tool';
import { LOAD_SKILL_TOOL } from './skillWords';
import { agentCarriedArguments, agentInputSkills, agentInputText } from './AgentSignal';
import { skillArguments } from './skillReferences';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

export const SKILL_REQUEST_INSTRUCTIONS =
  'An unescaped $skill-id naming a listed skill in reader input explicitly requests that skill; a dollar word naming no listed skill is ordinary text. A JSON-quoted id after the dollar, such as $"Review Notes", preserves names outside the bare lowercase grammar. Call load_skill for each requested id before other work. Dollars inside code or double-bracket references, or preceded by a backslash, are literal. A highlighted reference is a request, not a loaded instruction payload.';

export type AgentSkillReference = {
  readonly name: string;
  readonly description?: string;
};

export type AgentSkill<TCtx, TId extends string = string> = {
  readonly id: TId;
  readonly description: string;
  readonly location?: string;
  readonly references?: readonly AgentSkillReference[];
  readonly arguments?: true;
  instructions(ctx: TCtx): string | Effect.Effect<string, AgentSkillUnreadable>;
  reference?(name: string): Effect.Effect<string, AgentSkillUnreadable>;
  tools?(ctx: TCtx): ToolCatalog;
};

export const SKILL_ARGUMENTS = '$ARGUMENTS';

function invokingArguments(id: string, messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const text = agentInputSkills(message)?.has(id) ? agentInputText(message) : null;
    if (text !== null) return skillArguments(text, id);
    const carried = agentCarriedArguments(message)?.[id];
    if (carried !== undefined) return carried;
  }
  return '';
}

export class AgentSkillUnreadable extends Data.TaggedError('AgentSkillUnreadable')<{ readonly reason: string }> {}

export type AgentSkillPool<TCtx, TId extends string = string> = readonly AgentSkill<TCtx, TId>[];

export type AgentSkillReferenceText = { readonly name: string; readonly text: string };

export type AgentSkillLoadResult<TId extends string = string> =
  | {
      readonly status: 'loaded';
      readonly skill: TId;
      readonly location?: string;
      readonly instructions: string;
      readonly references?: readonly AgentSkillReferenceText[];
    }
  | {
      readonly status: 'already-loaded';
      readonly skill: TId;
      readonly note: string;
      readonly references?: readonly AgentSkillReferenceText[];
    };

export type AgentSkillSummary = {
  readonly id: string;
  readonly description: string;
  readonly references?: readonly AgentSkillReference[];
};

export const SKILL_REFERENCE_INSTRUCTIONS = `A skill listing \`refs\` keeps those sections apart from its body: name the ones the task needs in \`references\` of the same \`${LOAD_SKILL_TOOL}\` call, and read any other later from its \`location\`.`;

export const agentSkillLine = (skill: AgentSkillSummary): string => {
  const references = skill.references ?? [];
  const listed = references.map((one) => (one.description === undefined ? one.name : `${one.name} (${one.description})`));
  return `- ${skill.id}: ${skill.description}${listed.length === 0 ? '' : ` refs: ${listed.join(', ')}`}`;
};

export function agentSkillCatalogBlock<TCtx, TId extends string>(skills: AgentSkillPool<TCtx, TId>): string {
  if (skills.length === 0) return '';
  indexSkills(skills);
  return [
    'Skills:',
    ...skills.map(agentSkillLine),
    SKILL_REQUEST_INSTRUCTIONS,
    `A skill is loaded IFF its current instruction payload is present in model-visible message history. When a task matches a skill description, you MUST call \`${LOAD_SKILL_TOOL}\` with its id before acting. Loading returns the skill's full instructions as a tool result, unlocks its tools, and never changes the system prompt; a skill already loaded answers a short note instead of repeating its body. If compaction removes the payload, the skill is locked again and you MUST load it before matching work. If no skill matches and none is explicitly requested, DON'T load one.`,
    ...(skills.some((skill) => (skill.references?.length ?? 0) > 0) ? [SKILL_REFERENCE_INSTRUCTIONS] : []),
  ].join('\n');
}

export function agentSkillTools<TCtx, TId extends string>(skills: AgentSkillPool<TCtx, TId>, ctx: TCtx): ToolCatalog {
  if (skills.length === 0) return {};
  const byId = indexSkills(skills);
  const ids = skills.map((skill) => skill.id) as [TId, ...TId[]];
  const loader: ToolCatalog = {
    [LOAD_SKILL_TOOL]: Tool.make({
      approval: ASKS_NEVER,
      description:
        'Load a skill by id. Returns its full instructions and unlocks its tools while this result remains in model-visible message history. A skill read from disk also returns its `location`: the absolute folder every relative path in its instructions resolves against. `references` names sections from the skill’s `refs` to return with it.',
      parameters: Schema.Struct({
        skill: Schema.Literals(ids),
        references: Schema.optional(Schema.Array(Schema.NonEmptyString)).annotate({
          description: 'Sections the skill’s catalog line lists under `refs`, returned beside its instructions.',
        }),
      }),
      display: ({ skill }) => ({ form: 'none', title: skill }),
      execute: Effect.fnUntraced(function* ({ skill, references }, call) {
        const selected = byId.get(skill);
        if (!selected) return yield* Effect.fail(new ToolFailed({ reason: `Unknown agent skill: ${skill}.` }));
        const unread = (unreadable: AgentSkillUnreadable) => new ToolFailed({ reason: unreadable.reason });
        const instructions = yield* resolvedInstructions(selected, ctx, call.messages).pipe(Effect.mapError(unread));
        const asked = yield* referenceTexts(selected, references ?? []).pipe(Effect.mapError(unread));
        const delivered = deliveredPayloads(skills, call.messages).get(skill);
        const armed = selected.tools ? Object.keys(selected.tools(ctx)).length : 0;
        const facts = [
          ...(selected.location === undefined ? [] : [{ label: 'location', value: selected.location }]),
          ...(armed === 0 ? [] : [{ label: 'tools', value: String(armed) }]),
          ...(asked.length === 0 ? [] : [{ label: 'references', value: asked.map((one) => one.name).join(', ') }]),
        ];
        const returned = asked.length === 0 ? undefined : asked;
        if (delivered?.has(instructions)) {
          const note =
            'This skill is already loaded: its current instructions are in visible history. Re-read them there; they were not repeated here.';
          const already = [...facts, { label: 'already', value: 'in history' }];
          return new ToolAnswer(
            { status: 'already-loaded', skill, note, references: returned } satisfies AgentSkillLoadResult<TId>,
            asked.length === 0
              ? { form: 'none', title: skill, facts: already }
              : { form: 'markdown', title: skill, text: asked.map((one) => one.text).join('\n\n'), facts: already },
          );
        }
        const answer: AgentSkillLoadResult<TId> =
          selected.location === undefined
            ? { status: 'loaded', skill, instructions, references: returned }
            : { status: 'loaded', skill, location: selected.location, instructions, references: returned };
        return new ToolAnswer(answer, {
          form: 'markdown',
          title: skill,
          text: [instructions, ...asked.map((one) => one.text)].join('\n\n'),
          facts,
        });
      }),
    }),
  };
  return mergeToolCatalogs(loader, ...skills.flatMap((skill) => (skill.tools ? [skill.tools(ctx)] : [])));
}

export function agentSkillRule<TCtx, TId extends string>(skills: AgentSkillPool<TCtx, TId>): AgentRule<TCtx> {
  return agentRule(
    'agent-skills',
    (ctx) => {
      const gated = gatingSkills(skills);
      if (gated.length === 0 || ctx.hook !== 'beforeStep') return null;
      return loadedAgentSkillIds(gated, ctx, ctx.modelMessages).pipe(
        Effect.map((loaded) => {
          const locked = gated.filter((skill) => !loaded.has(skill.id));
          const tools = locked.flatMap((skill) => (skill.tools ? Object.keys(skill.tools(ctx)) : []));
          return tools.length > 0 ? { type: 'exclude' as const, tools } : null;
        }),
      );
    },
    { owner: 'skills', critical: true },
  );
}

const gatingPools = new WeakMap<object, readonly unknown[]>();

function gatingSkills<TCtx, TId extends string>(skills: AgentSkillPool<TCtx, TId>): AgentSkillPool<TCtx, TId> {
  const known = gatingPools.get(skills);
  if (known !== undefined) return known as AgentSkillPool<TCtx, TId>;
  const gated = skills.filter((skill) => skill.tools !== undefined);
  gatingPools.set(skills, gated);
  return gated;
}

export const loadedAgentSkillIds = Effect.fn('loadedAgentSkillIds')(function* <TCtx, TId extends string>(
  skills: readonly AgentSkill<TCtx, TId>[],
  ctx: TCtx,
  messages: readonly Message[],
): Effect.fn.Return<ReadonlySet<TId>> {
  indexSkills(skills);
  const payloads = deliveredPayloads(skills, messages);
  const loaded = new Set<TId>();
  for (const skill of skills) {
    const delivered = payloads.get(skill.id);
    if (!delivered) continue;
    const current = yield* resolvedInstructions(skill, ctx, messages).pipe(
      Effect.catchTag('AgentSkillUnreadable', () => Effect.succeed(null)),
    );
    if (current !== null && delivered.has(current)) loaded.add(skill.id);
  }
  return loaded;
});

function deliveredPayloads<TCtx, TId extends string>(
  skills: readonly AgentSkill<TCtx, TId>[],
  messages: readonly Message[],
): Map<TId, Set<string>> {
  const payloads = new Map<TId, Set<string>>();
  for (const message of messages) {
    if (message.role !== 'assistant' && message.role !== 'tool') continue;
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.name !== LOAD_SKILL_TOOL) continue;
      const result = skillLoadResult(part);
      const skillId = result ? skills.find((skill) => skill.id === result.skill)?.id : undefined;
      if (!result || !skillId) continue;
      const instructions = payloads.get(skillId) ?? new Set<string>();
      instructions.add(result.instructions);
      payloads.set(skillId, instructions);
    }
  }
  return payloads;
}

function indexSkills<TCtx, TId extends string>(skills: readonly AgentSkill<TCtx, TId>[]): Map<TId, AgentSkill<TCtx, TId>> {
  const byId = new Map<TId, AgentSkill<TCtx, TId>>();
  for (const skill of skills) {
    if (byId.has(skill.id)) throw new Error(`Duplicate agent skill: ${skill.id}.`);
    byId.set(skill.id, skill);
  }
  return byId;
}

const resolvedInstructions = Effect.fn('resolvedInstructions')(function* <TCtx>(
  skill: AgentSkill<TCtx>,
  ctx: TCtx,
  messages: readonly Message[],
): Effect.fn.Return<string, AgentSkillUnreadable> {
  const unreadable = (cause: unknown) => new AgentSkillUnreadable({ reason: cause instanceof Error ? cause.message : String(cause) });
  const read = yield* Effect.try({ try: () => skill.instructions(ctx), catch: unreadable });
  const text = typeof read === 'string' ? read : yield* read;
  if (text.trim().length === 0) {
    return yield* new AgentSkillUnreadable({ reason: `Agent skill ${skill.id} has empty instructions.` });
  }
  if (!skill.arguments) return text;
  const given = invokingArguments(skill.id, messages);
  return text.replaceAll(SKILL_ARGUMENTS, () => given);
});

const referenceTexts = Effect.fnUntraced(function* <TCtx>(
  skill: AgentSkill<TCtx>,
  names: readonly string[],
): Effect.fn.Return<readonly AgentSkillReferenceText[], AgentSkillUnreadable> {
  if (names.length === 0) return [];
  const read = skill.reference;
  if (read === undefined) {
    return yield* new AgentSkillUnreadable({ reason: `Agent skill ${skill.id} has no references.` });
  }
  return yield* Effect.forEach([...new Set(names)], (name) => Effect.map(read(name), (text) => ({ name, text })));
});

function skillLoadResult(part: ToolResultPart): Extract<AgentSkillLoadResult, { status: 'loaded' }> | null {
  if (part.result.type !== 'json') return null;
  const value = part.result.value as { status?: unknown; skill?: unknown; instructions?: unknown } | null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (value.status !== 'loaded' || typeof value.skill !== 'string' || typeof value.instructions !== 'string') {
    return null;
  }
  return { status: 'loaded', skill: value.skill, instructions: value.instructions };
}
