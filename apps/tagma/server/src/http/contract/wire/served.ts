export const API_PREFIX = '/api/';

export const ARTIFACT_PREFIX = '/a/';

export const HEALTH_PATH = '/health';

export const STARTUP_PATH = '/startup';

export const RESOURCE_PREFIXES: readonly string[] = [API_PREFIX, ARTIFACT_PREFIX];

export const servesResource = (pathname: string): boolean => RESOURCE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
