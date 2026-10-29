import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { AUDIT_NODES, Audited } from './audit.js';
import { Ref } from './ids.js';
import { DRIVE_REFUSALS, page, project, READING } from './shape.js';

export const AUDIT_OPERATIONS = {
  audit_page: operation('audit_page', {
    ...READING,
    meaning:
      'Audit the accessibility of a page with axe-core and answer its violations by rule, each failing node with a reference act_on_page takes.',
    grammar:
      'Rules run in every frame of the page, other-process frames included, inside the engine’s isolated world: the page’s own scripts never see them. Violations come most severe first with their impact, the requirement in one line, the WCAG tags and the failing nodes; `limit` bounds the nodes listed across rules, shared so each rule shows some, and `failing` counts them all. A node’s `ref` is the one snapshot_page shows for it. `incomplete` counts nodes axe-core could not judge; `skipped` names frames that could not be audited. `within` audits the subtree of one reference; `tags` runs only rules carrying one of the axe-core tags named, such as wcag2a, wcag2aa, wcag21aa, wcag22aa or best-practice. Hung-renderer detection pauses for the profile while rules run.',
    input: Schema.Struct({
      project,
      page,
      within: Schema.optional(Ref),
      tags: Schema.optional(Schema.NonEmptyArray(Schema.String.check(Schema.isMinLength(1)))),
      limit: limitOf(AUDIT_NODES),
    }),
    answer: arms({ audited: Audited.fields }),
    refusals: [...DRIVE_REFUSALS, 'stale-ref', 'audit-failed'],
    confirmation: () => ({ summary: 'Audit the page?' }),
    confirmLabel: 'Audit page',
    presentation: { running: 'Auditing the page', done: 'Audited the page' },
  }),
};

export type AuditOperationId = keyof typeof AUDIT_OPERATIONS;
