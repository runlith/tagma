export const REDACTED = '<redacted>';

const SENSITIVE_NAME_SOURCE =
  'authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature|account[-_]?id|session[-_]?id';
export const SENSITIVE_NAME = new RegExp(SENSITIVE_NAME_SOURCE, 'i');
const SHORT_QUERY_NAME = /^(key|sig)$/i;
const SENSITIVE_BODY_FIELD = new RegExp(`(?:${SENSITIVE_NAME_SOURCE}|key)`, 'i');
const REDACT_JSON_FIELD = new RegExp(
  `((?:"(?:${SENSITIVE_BODY_FIELD.source})"|\\b(?:${SENSITIVE_BODY_FIELD.source}))\\s*:\\s*)"(?:[^"\\\\]|\\\\[\\s\\S])*(?:"(?![^"\\r\\n]*"[ \\t]*:)|\\\\?(?=$|[\\r\\n]))`,
  'gi',
);
const REDACT_QUERY_FIELD = new RegExp(`((?:${SENSITIVE_BODY_FIELD.source})=)[^&\\s"]+`, 'gi');

export const isSensitiveName = (name: string): boolean => SENSITIVE_NAME.test(name);

export const isSensitiveQueryName = (name: string): boolean => isSensitiveName(name) || SHORT_QUERY_NAME.test(name);

const SECRET_MIN_LENGTH = 4;

export function secretsOf(
  pairs: Iterable<readonly [string, string]>,
  isSensitive: (name: string) => boolean = isSensitiveName,
): ReadonlySet<string> {
  const values = new Set<string>();
  const add = (value: string) => {
    if (value.length < SECRET_MIN_LENGTH) return;
    values.add(value);
    values.add(encodeURIComponent(value));
  };
  for (const [name, value] of pairs) {
    if (!isSensitive(name)) continue;
    add(value);
    const bearer = /^Bearer\s+(.+)$/i.exec(value)?.[1];
    if (bearer) add(bearer);
  }
  return values;
}

export function redactSecrets(text: string, secrets: Iterable<string> = []): string {
  const structural = text.replace(REDACT_JSON_FIELD, `$1"${REDACTED}"`).replace(REDACT_QUERY_FIELD, `$1${REDACTED}`);
  return Array.from(secrets).reduce((value, secret) => value.split(secret).join(REDACTED), structural);
}
