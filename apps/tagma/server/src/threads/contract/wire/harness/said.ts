import { Schema } from 'effect';

const HARNESS_REPORT_MAX = 20_000;

const HARNESS_ANSWER_PROSE_MAX = 824;

export const HARNESS_ANSWER_MAX = HARNESS_REPORT_MAX - HARNESS_ANSWER_PROSE_MAX;

export const harnessSaidSchema = Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(HARNESS_ANSWER_MAX)));

export const harnessCutSchema = Schema.Record(Schema.String, Schema.Int.check(Schema.isGreaterThan(0)));
