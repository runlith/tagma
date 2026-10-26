import { Schema } from 'effect';

export const SECRETS_POINT = 'secrets';

export const SECRET_NAME_PATTERN = /^(?!TAGMA_)[A-Z][A-Z0-9_]*$/u;

export const SECRET_VALUE_MAX = 16_384;

const BASE_ENVIRONMENT = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'TMPDIR'] as const;

export const SECRET_MAX_PER_PLUGIN = 8;

export const SecretName = Schema.String.check(
  Schema.isPattern(SECRET_NAME_PATTERN),
  Schema.isMaxLength(64),
  Schema.makeFilter((name: string) =>
    BASE_ENVIRONMENT.some((taken) => taken === name) ? `${name} is a variable every process is started with` : true,
  ),
).annotate({
  description:
    'The secret, named as the environment variable its process reads it from: capital letters, digits and underscores, not starting with TAGMA_ and not one the process is started with (PATH, HOME, USER, LOGNAME, SHELL, TERM, TMPDIR).',
});

export const SecretEntry = Schema.Struct({
  name: SecretName,
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)).annotate({
    description: 'What the operator is asked for, shown beside the field where they fill it.',
  }),
});
export type SecretEntry = typeof SecretEntry.Type;

export const SecretEntries = Schema.Array(SecretEntry)
  .check(
    Schema.isMaxLength(SECRET_MAX_PER_PLUGIN),
    Schema.makeFilter((entries: readonly SecretEntry[]) => {
      const seen = new Set<string>();
      for (const { name } of entries) {
        if (seen.has(name)) return `the secret ${name} is listed twice`;
        seen.add(name);
      }
      return true;
    }),
  )
  .annotate({
    description:
      'Up to 8 secrets the operator fills in the plugin’s settings. The process receives each value in the environment variable of its name; a secret without a value is absent there. What the process answers over MCP — text, structured data, resources, tool descriptions and failures — is masked where it carries a value; what it sends to Tagma over HTTP is not.',
  });
export type SecretEntries = typeof SecretEntries.Type;
