import { Effect } from 'effect';
import { type AgentSkill, AgentSkillUnreadable } from '@runlith/agent/AgentSkill';
import type { BridgeMethod } from '../../views/contract/wire/bridge.js';

const APPS_SKILL = 'apps';

const BRIDGE_MARK = '<!-- bridge-methods -->';

const lineOf = (method: BridgeMethod): string => {
  const notified = method.notifications.map((notification) => `\`${notification}\``).join(', ');
  return [
    `- \`tagma/${method.id} ${method.signature}\` — ${method.description}`,
    ...(notified === '' ? [] : [`Notifies ${notified}.`]),
    ...(method.reference === undefined ? [] : [`Reference: \`${method.id}\`.`]),
  ].join(' ');
};

const bridgeList = (methods: readonly BridgeMethod[]): string => methods.map(lineOf).join('\n');

export function withBridgeMethods<TContext>(
  skills: readonly AgentSkill<TContext>[],
  methods: readonly BridgeMethod[],
): AgentSkill<TContext>[] {
  const referenced = methods.flatMap((method) => (method.reference === undefined ? [] : [{ method, reference: method.reference }]));
  const render = (text: string): string => text.replace(BRIDGE_MARK, () => bridgeList(methods));
  return skills.map((skill) => {
    if (skill.id !== APPS_SKILL) return skill;
    return {
      ...skill,
      references: [
        ...(skill.references ?? []),
        ...referenced.map(({ method, reference }) => ({ name: method.id, description: reference.title })),
      ],
      instructions: (ctx) => {
        const text = skill.instructions(ctx);
        return typeof text === 'string' ? render(text) : Effect.map(text, render);
      },
      reference: (name) => {
        const declared = referenced.find(({ method }) => method.id === name);
        if (declared !== undefined) return Effect.succeed(`# ${declared.reference.title}\n\n${declared.reference.text}`);
        return (
          skill.reference?.(name) ?? Effect.fail(new AgentSkillUnreadable({ reason: `Agent skill ${skill.id} has no reference ${name}.` }))
        );
      },
    };
  });
}
