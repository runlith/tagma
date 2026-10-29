import { family } from '@runlith/paging';
import { Schema } from 'effect';
import { Ref } from './ids.js';
import { Glance } from './page.js';

export const IMPACTS = ['critical', 'serious', 'moderate', 'minor'] as const;

export const WHY_CHARS = 240;

export const HTML_CHARS = 160;

export const AUDIT_NODES = family('page-audit-nodes', 1, 'json', { text: 520, json: 520 }, 30, () => ({
  ref: 'e1204',
  why: 'x'.repeat(WHY_CHARS),
  html: 'x'.repeat(HTML_CHARS),
}));

export const FailingNode = Schema.Struct({
  ref: Schema.NullOr(Ref).annotate({
    description: 'The reference act_on_page and snapshot_page take; null when the node left the page before the audit answered.',
  }),
  why: Schema.String.annotate({ description: 'What fails on this node, as axe-core measured it.' }),
  html: Schema.String,
});
export type FailingNode = typeof FailingNode.Type;

export const Violation = Schema.Struct({
  rule: Schema.String,
  impact: Schema.NullOr(Schema.Literals(IMPACTS)),
  help: Schema.String.annotate({ description: 'What the rule requires, in one line.' }),
  url: Schema.String,
  wcag: Schema.Array(Schema.String).annotate({ description: 'The WCAG tags of the rule; empty for a best practice.' }),
  failing: Schema.Int.annotate({ description: 'How many nodes fail the rule; `nodes` lists the share the limit left it.' }),
  nodes: Schema.Array(FailingNode),
});
export type Violation = typeof Violation.Type;

export const Audited = Schema.Struct({
  page: Glance,
  violations: Schema.Array(Violation),
  shown: Schema.Int,
  total: Schema.Int.annotate({ description: 'Failing nodes across every rule.' }),
  incomplete: Schema.Int.annotate({ description: 'Nodes axe-core could not judge, which want a human look.' }),
  passed: Schema.Int.annotate({ description: 'Rules every node passed.' }),
  frames: Schema.Int.annotate({ description: 'Documents audited: the page and its frames.' }),
  skipped: Schema.Array(Schema.String).annotate({ description: 'Frames that could not be audited, by address.' }),
});
export type Audited = typeof Audited.Type;
