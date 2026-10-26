import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta, ProfileSummary } from '../protocol/reports.js';
import { cpuProfileArtifactSchema, profileFrames, storedProfileRequestSchema } from '../CpuProfile.js';
import { performanceRecord } from '../schema.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { byTime, fan, firstOf, timePageConditions } from './page.js';
import { readRecord } from './record.js';

export const readProfiles = Effect.fn('PerformanceWorker.readProfiles')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'profiles' }>,
  meta: PerformanceReportMeta,
) {
  const rows = yield* fan(readers, (reader) =>
    reader.db
      .select({
        id: performanceRecord.id,
        instanceId: performanceRecord.instanceId,
        wallTime: performanceRecord.wallTime,
        monotonicStart: performanceRecord.monotonicStart,
        monotonicEnd: performanceRecord.monotonicEnd,
        requestedBy: sql<unknown>`json_extract(${performanceRecord.payload}, '$.requestedBy')`,
        requestedDurationMs: sql<unknown>`json_extract(${performanceRecord.payload}, '$.requestedDurationMs')`,
      })
      .from(performanceRecord)
      .where(and(...timePageConditions('profile', query)))
      .orderBy(asc(performanceRecord.wallTime), asc(performanceRecord.id))
      .limit(query.limit + 1),
  );
  rows.sort(byTime);
  const visible = rows.slice(0, query.limit);
  const profiles: ProfileSummary[] = [];
  for (const row of visible) {
    const request = yield* Schema.decodeUnknownEffect(storedProfileRequestSchema)({
      requestedBy: row.requestedBy,
      requestedDurationMs: row.requestedDurationMs,
    }).pipe(Effect.mapError(() => new PerformanceRecordUnreadable({ recordId: row.id })));
    profiles.push({
      id: row.id,
      instanceId: row.instanceId,
      wallTime: row.wallTime,
      monotonicStart: row.monotonicStart,
      monotonicEnd: row.monotonicEnd,
      requestedBy: request.requestedBy,
      requestedDurationMs: request.requestedDurationMs,
    });
  }
  const last = rows.length > query.limit ? profiles.at(-1) : undefined;
  return {
    _tag: 'Found',
    report: {
      type: 'profiles',
      ...meta,
      profiles,
      next: last === undefined ? null : { wallTime: last.wallTime, id: last.id },
    },
  } satisfies ReportAnswer;
});

export const readProfile = Effect.fn('PerformanceWorker.readProfile')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'profile' }>,
  meta: PerformanceReportMeta,
) {
  const row = yield* firstOf(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(and(eq(performanceRecord.id, query.id), eq(performanceRecord.kind, 'profile')))
      .get(),
  );
  if (row === undefined) return { _tag: 'NotFound', query } satisfies ReportAnswer;
  const profile = yield* readRecord(row);
  if (profile.kind !== 'profile') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
  const artifact = yield* Schema.decodeUnknownEffect(cpuProfileArtifactSchema)(profile.payload.profile).pipe(
    Effect.mapError(() => new PerformanceRecordUnreadable({ recordId: row.id })),
  );
  const ranked = profileFrames(artifact);
  const frames = query.limit === undefined ? ranked : ranked.slice(0, query.limit);
  return {
    _tag: 'Found',
    report: {
      type: 'profile',
      ...meta,
      profile: {
        ...profile,
        payload: {
          requestedBy: profile.payload.requestedBy,
          requestedDurationMs: profile.payload.requestedDurationMs,
          profile: query.raw === true ? profile.payload.profile : undefined,
        },
      },
      frames,
    },
  } satisfies ReportAnswer;
});
