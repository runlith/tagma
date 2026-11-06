import { Effect } from 'effect';
import { type AgentSkill, AgentSkillUnreadable } from '@runlith/agent/AgentSkill';
import type { CapabilityDeclaration } from '../../views/contract/wire/capabilities.js';

const PLUGINS_SKILL = 'plugins';

const CAPABILITIES_MARK = '<!-- view-capabilities -->';

const lineOf = (declared: CapabilityDeclaration): string =>
  [
    `- \`${declared.id}${declared.signature}\` — ${declared.description}`,
    ...(declared.reference === undefined ? [] : [`Reference: \`${declared.id}\`.`]),
  ].join(' ');

export function withViewCapabilities<TContext>(
  skills: readonly AgentSkill<TContext>[],
  declarations: readonly CapabilityDeclaration[],
): AgentSkill<TContext>[] {
  const referenced = declarations.flatMap((declared) =>
    declared.reference === undefined ? [] : [{ declared, reference: declared.reference }],
  );
  const render = (text: string): string => text.replace(CAPABILITIES_MARK, () => declarations.map(lineOf).join('\n'));
  return skills.map((skill) => {
    if (skill.id !== PLUGINS_SKILL) return skill;
    return {
      ...skill,
      references: [
        ...(skill.references ?? []),
        ...referenced.map(({ declared, reference }) => ({ name: declared.id, description: reference.title })),
      ],
      instructions: (ctx) => {
        const text = skill.instructions(ctx);
        return typeof text === 'string' ? render(text) : Effect.map(text, render);
      },
      reference: (name) => {
        const found = referenced.find(({ declared }) => declared.id === name);
        if (found !== undefined) return Effect.succeed(`# ${found.reference.title}\n\n${found.reference.text}`);
        return (
          skill.reference?.(name) ?? Effect.fail(new AgentSkillUnreadable({ reason: `Agent skill ${skill.id} has no reference ${name}.` }))
        );
      },
    };
  });
}
