import { COMMENT_POLICIES, type CommentPolicy } from '@runlith/source-comments';
import { Schema } from 'effect';
import type { CheckoutMode } from '@runlith/agent-tools/workspace';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../platform/contract/wire/setting.js';
import { nameRef } from './contract/wire/fields.js';

export const commentPolicy = settingKey({
  id: 'writing.comments',
  order: 10,
  title: 'Comments',
  description: 'What a prose comment written into this checkout meets at the doors that land it.',
  schema: Schema.Literals(COMMENT_POLICIES),
  control: {
    kind: 'choice',
    choices: [
      {
        value: 'allowed',
        label: 'Allowed',
        hint: 'Comments are kept as written.',
      },
      {
        value: 'forbid',
        label: 'Forbidden',
        hint: 'A prose comment a change adds is dropped by the door that lands it; `//!` marks the one deliberate exception, and the why goes into the graph.',
      },
    ],
  },
  fallback: 'allowed' as CommentPolicy,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const MAP_BASE = 6_000;

const SMALLEST_MAP_BUDGET = 222;

export const mapBudget = settingKey({
  id: 'orientation.mapBudget',
  order: 20,
  title: 'Map size',
  description:
    "How much of a thread's orientation the map of this project's containers may spend; past it the map cuts depth and each container says how many of its own children it left out.",
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(SMALLEST_MAP_BUDGET)),
  control: { kind: 'number', minimum: SMALLEST_MAP_BUDGET, step: 100, unit: 'characters' },
  fallback: MAP_BASE,
  scopes: ['project'],
  merge: 'replace',
  shapesStart: 'graph',
});

const GRAPH_COMMIT_POLICIES = ['auto', 'manual', 'off'] as const;
export type GraphCommitPolicy = (typeof GRAPH_COMMIT_POLICIES)[number];

export const graphCommit = settingKey({
  id: 'graph.commit',
  order: 30,
  title: 'Who commits the tree',
  description: 'Who commits the block tree of a team checkout; a stealth project keeps its tree outside the repository.',
  schema: Schema.Literals(GRAPH_COMMIT_POLICIES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'auto', label: 'Tagma', hint: 'Tagma commits the block tree itself, in its own commit after each code commit.' },
      { value: 'manual', label: 'On sync', hint: 'Only an explicit sync commits it.' },
      { value: 'off', label: 'Nobody', hint: 'The tree stands in the checkout as ordinary uncommitted work.' },
    ],
  },
  fallback: 'auto' as GraphCommitPolicy,
  scopes: ['project'],
  merge: 'replace',
});

const CHECKOUT_MODES = ['shared', 'single'] as const satisfies readonly CheckoutMode[];

export const checkoutMode = settingKey({
  id: 'agent.checkout',
  order: 40,
  title: 'Checkout',
  description: 'Whether the project checkout has other writers.',
  schema: Schema.Literals(CHECKOUT_MODES),
  control: {
    kind: 'choice',
    choices: [
      {
        value: 'shared',
        label: 'Shared',
        hint: 'Other agents write this tree: the shared-checkout law is carried, and git commands that sweep the tree are refused.',
      },
      { value: 'single', label: 'Single', hint: 'One writer: classic git, and nothing is refused.' },
    ],
  },
  fallback: 'shared' as CheckoutMode,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const autoCommit = settingKey({
  id: 'agent.autoCommit',
  order: 45,
  title: 'Agents commit their own work',
  description:
    'Whether an agent commits its own work as soon as it is ready and before its run ends. Off, its changes stay in the working tree until someone asks for a commit.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const globalRules = settingKey({
  id: 'rules.global.enabled',
  order: 50,
  title: 'Global rules',
  description: "Whether the rules of the global graph reach this project's threads. Off, none of them does.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
  shapesStart: 'law',
});

export const rulesOff = settingListKey({
  id: 'rules.global.disabled',
  order: 60,
  title: 'Global rules turned off',
  description: "Global rules, by name, that do not reach this project's threads; every other global rule still does.",
  member: nameRef,
  fallback: [] as readonly string[],
  scopes: SETTABLE_SCOPES,
  merge: 'union',
  shapesStart: 'law',
});

export const GRAPH_SETTING_KEYS = [commentPolicy, mapBudget, graphCommit, checkoutMode, autoCommit, globalRules, rulesOff] as const;

export const GRAPH_SETTING_SECTIONS = [
  {
    id: 'writing',
    order: 10,
    title: 'Writing',
    description: 'What a prose comment written into this checkout meets at the doors that land it.',
  },
  {
    id: 'orientation',
    order: 20,
    title: 'Orientation',
    description: 'How much of what a session reads before it knows anything the map of this project may spend.',
  },
  {
    id: 'rules',
    order: 25,
    title: 'Global rules',
    description: 'Which rules of the global graph reach the threads of this project: all of them, none, or all but the ones named.',
  },
  {
    id: 'graph',
    order: 30,
    title: 'Graph files',
    description:
      'How the block tree reaches where it is kept: a team checkout’s branch, or the private remote of a stealth graph, which Tagma keeps outside the repository.',
  },
] as const;
