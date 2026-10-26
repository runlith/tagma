export const METADATA_LIMITS = { bytes: 64 * 1024, recordBytes: 2 * 64 * 1024, records: 64 * 1024 } as const;
export const DOCUMENT_LIMITS = { bytes: 64 * 1024, recordBytes: 8 * 1024 * 1024, records: 1 } as const;
export const TRANSCRIPT_LIMITS = { ...METADATA_LIMITS, recordBytes: DOCUMENT_LIMITS.recordBytes } as const;
export const METADATA_CADENCE = 5_000;
export const METADATA_CONCURRENCY = 6;
export const METADATA_PAGES = 512;
