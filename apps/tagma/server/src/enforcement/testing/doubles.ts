import { Effect, Stream } from 'effect';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { Configs } from '../../config/contract/service/configs.js';
import type { Descriptor } from '../../config/contract/wire/config.js';
import { holderOf, UNCHECKED } from '../contract/wire/checks.js';
import type { RuleChecks } from '../contract/service/ruleChecks.js';
import type { Remeasure } from '../contract/service/remeasure.js';
import { enforcingAt } from '../remeasure/memory.js';

const unbound = (member: string) => Effect.die(`RuleChecks.${member} was asked in a test that binds no rule checks`);

export const UNBOUND_CHECKS: RuleChecks['Service'] = {
  before: () => unbound('before'),
  after: () => unbound('after'),
  landed: () => unbound('landed'),
};

export const NO_RULES: RuleChecks['Service'] = {
  before: () => Effect.succeed(UNCHECKED),
  after: () => Effect.void,
  landed: (_op, subject) => Effect.succeed({ commit: subject.commit, holder: holderOf(subject.caller) }),
};

export const describedBy = (inspections: ReadonlyMap<string, Descriptor>): Configs['Service'] =>
  Configs.of({
    read: () => Effect.succeed({ inspections, format: [], derive: [], footprint: [] }),
    carried: ({ commits }) => Effect.succeed(new Set(commits)),
  });

export const QUIET_CHECKOUTS = CheckoutRows.of({
  read: () => Effect.die('the enforcement fixture does not read checkout rows'),
  refresh: () => Effect.die('the enforcement fixture does not refresh checkout rows'),
  subscribe: () => Stream.never,
  follow: () => Effect.succeed(Stream.never),
  mark: () => Effect.void,
  onMark: () => () => undefined,
  headMoved: () => Stream.never,
  headObserved: () => Stream.never,
  checkoutsMoved: () => Stream.never,
});

export const rememberedRoots = (memory: string): readonly string[] =>
  enforcingAt(memory)
    .all()
    .map((checkout) => checkout.root);

export const QUIET_DRIVER: Remeasure['Service'] = {
  opened: () => undefined,
  closed: () => undefined,
  ready: () => Effect.void,
  landed: () => Effect.void,
  checked: () => Effect.void,
  enforced: () => Effect.void,
  telling: () => () => undefined,
  tell: () => Effect.void,
};
