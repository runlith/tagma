import { Schema } from 'effect';
import { settingKey } from '../platform/contract/wire/setting.js';
import { AGENT_PACES, AWAKE_MODES, DEFAULT_AGENT_PACE, DEFAULT_AWAKE_MODE } from './contract/wire/power.js';

export const keepAwake = settingKey({
  id: 'power.keepAwake',
  order: 830,
  title: 'Keep this machine awake',
  description: 'Whether the machine running this server is held back from falling asleep on its own.',
  schema: Schema.Literals(AWAKE_MODES),
  control: {
    kind: 'choice',
    choices: [
      {
        value: 'while-working',
        label: 'While working',
        hint: 'Held while this server is driving a run or attending a session, released when the last of them ends or waits for you.',
      },
      { value: 'always', label: 'Always', hint: 'Held for as long as this server process runs, working or not.' },
      {
        value: 'off',
        label: 'Off',
        hint: 'Nothing is held; the machine sleeps on its own schedule, and a run asleep is a run that stops.',
      },
    ],
  },
  fallback: DEFAULT_AWAKE_MODE,
  scopes: ['user'],
  merge: 'replace',
});

export const agentWork = settingKey({
  id: 'power.agentWork',
  order: 840,
  title: "Agents' share of this machine",
  description:
    "How much of the machine running this server agents' commands may take. The operator's own terminals, Tagma's own work around a command and the server itself always run at full speed.",
  schema: Schema.Literals(AGENT_PACES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'full', label: 'Full', hint: "Agents' commands run as fast as the machine allows." },
      {
        value: 'low',
        label: 'Low',
        hint: "Agents' commands yield to your programs and use every core when nothing else wants it. Reaches commands started after the choice.",
      },
      {
        value: 'lowest',
        label: 'Lowest',
        hint: "Agents' commands run almost only on the efficiency cores, with their disk access throttled. Reaches running commands too.",
      },
    ],
  },
  fallback: DEFAULT_AGENT_PACE,
  scopes: ['user'],
  merge: 'replace',
  operatorOnly: true,
});

export const POWER_SETTING_SECTIONS = [
  {
    id: 'power',
    order: 120,
    title: 'Power',
    description:
      'What Tagma does to the sleep of the machine it runs on — which is the machine running this server, not the one running a browser.',
  },
] as const;
