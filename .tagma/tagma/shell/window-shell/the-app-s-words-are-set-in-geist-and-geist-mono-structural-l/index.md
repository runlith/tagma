---
id: 01a0d121-2eb5-7303-b5ab-66c63734162e
title: The app's words are set in Geist and Geist Mono, structural labels in the case they are written in, and Archivo only on the nameplate
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
---
The operator chose this on 2026-09-24, after comparing four candidates in the page "Tagma Agents Sidebar" (http://localhost:5634/a/d919fe395c8e, section 05).

**1. Outcome.** Every surface of the Tagma app sets its words in one family:
- running text in Geist;
- ids, paths, code, stamps and diffs in Geist Mono;
- structural labels (the `eyebrow` utility: AGENTS, PINNED, CHANGES and the rest) in Geist 600, in the case they are written in, with no expanded tracking.

The TAGMA nameplate in the top bar keeps expanded Archivo as a brand mark. Terminals keep their own font setting.

**2. Problem and evidence.**
- Archivo, the face of every structural label, ships only the latin, latin-ext and vietnamese subsets. Checked in `apps/tagma/app/node_modules/@fontsource-variable/archivo/files` and on Google Fonts. A Cyrillic label in that style falls back to another face mid-word, and the product has to carry labels in any language.
- The operator judges the wide, uppercase, tracked labels dated.

**3. What holds now.**
- `apps/tagma/app/src/app.css` imports `@fontsource-variable/inter`, `@fontsource-variable/archivo/wdth.css` and `@fontsource-variable/jetbrains-mono`.
- It sets `--font-sans` to Inter Variable, `--font-display` to Archivo Variable and `--font-mono` to JetBrains Mono Variable.
- The `eyebrow` utility sets the display face at 600, stretch 118%, tracking 0.14em, uppercase. It is used 66 times in 36 files. `font-display` is spelled directly 30 times in 25 files.
- The spatial graph canvases name `"Archivo Variable"` in their own font strings (`GraphView.svelte`, `MindMap.svelte`).
- `label-lift` exists because Inter's x-band sits low at small sizes ([[5997d591]]).

**4. Target.**
- `--font-sans`: `"Geist Variable"`, followed by a fallback stack that reaches system faces for scripts Geist lacks: system-ui, -apple-system, "Segoe UI", "Noto Sans", "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", "Geeza Pro", "Noto Sans Arabic", sans-serif.
- `--font-mono`: `"Geist Mono Variable"`, then ui-monospace, "SF Mono", Menlo, monospace.
- `eyebrow`: sans face, 600, no text transform, no expanded tracking. It stays a utility that owns face, size and spacing and never colour. Its size is re-chosen for sentence case, about 12–12.5px.
- Every direct `font-display` use becomes the sans face. The nameplate alone keeps Archivo through its own token (for example `--font-mark`), so no other surface can reach Archivo.
- The canvases take their family from the token rather than naming a face.
- `label-lift` is re-measured against Geist, then kept, re-tuned or removed on that measurement.

**5. Owners and boundaries.** The ink area [[b70292cb]] (`app.css`) owns every face. The top bar owns the nameplate's use of the mark face. No feature sets a family of its own, except the terminal, whose font is the user's setting.

**6. Rejected.**
- Inter: sound coverage, but it is the look of nearly every product around.
- Onest: good Cyrillic, but no monospace partner.
- IBM Plex Sans: the widest script family, but heavy at 12–13px.
- Keeping Archivo for labels: no Cyrillic.

**7. Acceptance.**
- Computed `font-family` of body text resolves Geist, and of `.stamp`, `code` and diff lines resolves Geist Mono.
- A search of `apps/tagma/app/src` finds Archivo only in the nameplate's token.
- `eyebrow` has `text-transform: none`, and a Cyrillic eyebrow renders in Geist (`document.fonts.check('12px "Geist Variable"', 'Щит')` holds after load).
- The app typecheck and test suite pass. The operator looks at the result.

**8. Standing claims.**
- [[27e9430f]] dies. A claim naming the new faces and the nameplate's exception replaces it, written from the code.
- [[f056bd0f]] and [[1452853b]] survive, unless the change moves what they state.
- [[5997d591]] is re-measured: it survives with its reason restated for Geist, or dies with the utility.
- No other claim names a face.

**9. Order.** One task.

**10. Contract.** out: no protocol, API or operation changes.
**11. Stored data.** out: no stored format.
**12. Who may.** out: no permission.
**13. Long-lived things.** out: none.
**14. Bounded resources.** The two variable families load per subset by `unicode-range` (latin, latin-ext, cyrillic, cyrillic-ext, vietnamese), in place of three families today. Archivo stays loaded for the nameplate only, and can be subset to latin.
**15. Rollout.** A page already open keeps the old faces until it reloads. Nothing is stored.
**16. Failures.** With the font files missing or offline, the fallback stack renders system faces. No layout depends on a face's metrics beyond `label-lift`.
**17. Observability.** The computed-style checks in acceptance, run once in a browser.
