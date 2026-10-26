import { z } from 'zod';

const readySchema = z.object({
  accessibilityTrusted: z.boolean(),
  tapActive: z.boolean(),
});

const holdSchema = z.object({
  transition: z.enum(['start', 'end', 'cancel']),
  shift: z.boolean(),
});

const accessibilitySchema = z.object({
  trusted: z.boolean(),
  tapActive: z.boolean(),
});

const pasteResultSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  error: z.string().nullish(),
});

const errorSchema = z.object({
  message: z.string(),
});

const envelopeSchema = z.object({
  message_type: z.string(),
  data: z.unknown(),
});

export type SidecarMessage =
  | { readonly kind: 'ready'; readonly data: z.infer<typeof readySchema> }
  | { readonly kind: 'hold'; readonly data: z.infer<typeof holdSchema> }
  | { readonly kind: 'escape' }
  | { readonly kind: 'accessibility'; readonly data: z.infer<typeof accessibilitySchema> }
  | { readonly kind: 'paste_result'; readonly data: z.infer<typeof pasteResultSchema> }
  | { readonly kind: 'error'; readonly data: z.infer<typeof errorSchema> };

export function parseSidecarLine(line: string): SidecarMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return null;

  switch (envelope.data.message_type) {
    case 'ready': {
      const data = readySchema.safeParse(envelope.data.data);
      return data.success ? { kind: 'ready', data: data.data } : null;
    }
    case 'hold': {
      const data = holdSchema.safeParse(envelope.data.data);
      return data.success ? { kind: 'hold', data: data.data } : null;
    }
    case 'escape':
      return { kind: 'escape' };
    case 'accessibility': {
      const data = accessibilitySchema.safeParse(envelope.data.data);
      return data.success ? { kind: 'accessibility', data: data.data } : null;
    }
    case 'paste_result': {
      const data = pasteResultSchema.safeParse(envelope.data.data);
      return data.success ? { kind: 'paste_result', data: data.data } : null;
    }
    case 'error': {
      const data = errorSchema.safeParse(envelope.data.data);
      return data.success ? { kind: 'error', data: data.data } : null;
    }
    default:
      return null;
  }
}
