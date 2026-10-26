export const RULE_SOURCES = {
  '@runlith/tagma/rules': new URL('./rules.ts', import.meta.url),
  '@runlith/tagma/rules/effect': new URL('./effect.ts', import.meta.url),
} as const;
