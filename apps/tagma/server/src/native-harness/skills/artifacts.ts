import { isAbsolute, resolve } from 'node:path';
import { Effect, type FileSystem, type Layer, Schema } from 'effect';
import type { AgentSkill } from '@runlith/agent/AgentSkill';
import { type Claim, Tool, ToolAnswer, ToolFailed, callerThread } from '@runlith/agent/tool';
import { resourcePath } from '@runlith/files/replace';
import type { ThreadWorld } from '../../executions/contract/service/worlds.js';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { versionAddress } from '../../artifacts/contract/wire/artifacts.js';
import { PUBLISH_TOOL, type PublishedPage } from '../../artifacts/contract/wire/published.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../platform/contract/wire/conditions.js';

export const ARTIFACT_SKILL_ID = 'artifacts';

const DESIGN = `# Writing a page Tagma will host

Approach this as the design lead at a small studio known for their versatility, giving every subject
a visual identity pitched at the treatment it actually calls for. Make deliberate choices about
palette, typography and layout that are specific to THIS subject, and avoid templated designs.

## The page is one standalone file

Write a complete document — \`<!doctype html>\` through \`</html>\`, with your own \`<head>\`,
\`<title>\` and \`<style>\`. Nothing is added to it at publish time and nothing sits beside it: this
server hands back the same bytes, so the file also opens from disk with a double click and can be
sent to somebody as itself. Everything is inline — the CSS, the scripts, images as \`data:\` URIs.

A page served here may load from these hosts and nowhere else, enforced as a CSP:

- scripts: \`cdnjs.cloudflare.com\`, \`cdn.jsdelivr.net\`, \`cdn.tailwindcss.com\`, \`code.jquery.com\`
- stylesheets: \`fonts.googleapis.com\`, with font files from \`fonts.gstatic.com\`

Everything else is blocked with no visible error — other hosts, and on those hosts anything but a
script or a font. The page may call nobody: \`fetch\`, XHR and WebSocket are refused outright, this
server included. So no \`<script type="module">\` (it also breaks when the file is opened from disk),
no separate asset, no runtime call home.

## Read the request first

Calibrate the TREATMENT, not whether to design. A memo deserves the same craft as a landing page;
what changes is how that craft is delivered.

Most requests are utilitarian — a report, a plan, a dashboard. Make them polished: real typographic
hierarchy, considered spacing, a proper palette. Most pages need no gigantic hero; keep flourishes
tasteful and few. Some are editorial — something the reader will keep or show someone. Then make
opinionated calls and take one real aesthetic risk where it serves the work.

When unsure: a well-composed page is never the wrong answer; an over-designed one sometimes is.

## Before writing code, write the plan

Sketch a compact token system and then derive every decision from it:

- **Color** — the palette as 4–6 named hex values.
- **Type** — typefaces for 2+ roles: a characterful display face used with restraint, a
  complementary body face, and a utility face for captions or data if the page needs one.
- **Layout** — the layout concept in one or two sentences.

Then build, following the plan. If any part of the plan reads like the generic default you would
produce for any similar page, revise that part before writing a line.

## Fundamentals

- **Ground it in the subject.** One concrete subject, its audience, the page's single job. The
  subject's own world — its materials, instruments, vernacular — is where distinctive choices come
  from. Real content throughout, never lorem.
- **Typography carries the page**, even when the page is not about typography. Google Fonts is the
  one font host admitted: link it directly and always declare a real fallback stack, because a
  reader offline gets the fallback. Running text near 65 characters wide, a type scale you stay on,
  \`text-wrap: balance\` on headings, a touch of letter-spacing on uppercase labels.
- **Choose neutrals, don't default to them.** A pure mid-grey reads as unconsidered; a grey biased
  slightly toward the accent reads as chosen.
- **Design both themes.** The reader's browser has three states, and the default stamps nothing —
  only \`prefers-color-scheme\` separates light from dark there. Define the complete light palette as
  tokens on bare \`:root\`; redefine ONLY those tokens under \`@media (prefers-color-scheme: dark)\`.
  Style everything through the tokens: a color whose only definition sits inside a media block never
  applies in the un-stamped state, which is the classic unreadable page. Give \`body\` an explicit
  background from a token. A design that deliberately commits to one visual world may stay
  single-theme — then paint every color explicitly and make it a choice, not an omission.
- **Let layout do the spacing.** Flex or grid with \`gap\`, not per-element margins that collapse or
  double. Wide content — tables, code, diagrams — gets \`overflow-x: auto\` on its own container so
  the body never scrolls sideways. \`font-variant-numeric: tabular-nums\` wherever digits line up.
- **Structure is information.** Numbering, eyebrows, dividers and labels encode something true about
  the content. Numbered markers (01 / 02 / 03) belong only where the content really is a sequence.
- **Words are design material.** Write from the reader's side of the screen; name things by what
  they recognize. Active voice. Specific beats clever.
- **Name the page like a product.** The \`<title>\` is what the reader sees in the tab and in the
  index of hosted pages: a short noun phrase, two to four words, specific to this subject. No
  explainer after a dash or colon — that goes in the publish description.
- **Build cleanly.** Watch selector specificity, close every non-void element, double-quote
  attributes, give keyboard focus a visible state. For generative or decorative graphics reach for
  Canvas rather than hand-authoring long SVG paths.
- **When it's a UI, not a document** — a dashboard is scanned and operated. Surface the summary
  before the detail; encode state in form as well as number (a pill, a chip, a severity stripe) so
  what needs attention reads at a glance. Semantic color (good / warning / critical) is separate
  from the accent and does not count as it.

## Avoid the generated look

Machine-written design clusters around a few looks. Where the operator pins a direction, follow it
exactly — their words always win. Where nothing is specified, don't spend that freedom on: warm
cream (#F4F1EA) with a serif display and terracotta accent; near-black with one acid-green or
vermilion pop; a purple-to-blue gradient hero on white; Inter or Space Grotesk as the "safe" face;
emoji as section markers; everything centered; rounded corners on everything; an accent bar on every
card. Spend your boldness in ONE place and keep everything around it quiet.

## Publishing

Write the page to a file, then call \`${PUBLISH_TOOL}\` with its path. The path IS the artifact's
identity: publishing the same path again replaces the page at the same URL and keeps the earlier
version; a different path claims a new URL. A revision, a fix or a variant the reader asked to see in
place of the page goes to the same path, so the reader keeps one URL for it; only a separate page
gets a new path. The pages this server hosts are listed at the root of the artifact port, and
\`tagma artifacts\` lists them in a terminal.

The user sees each publication in this thread as a card: the page itself, playing in a player when
it declares a timeline, with a link and a way to open it beside the thread. So do not repeat the URL
in your answer. The card frames the page in a sandbox with an opaque origin, where \`localStorage\`
and \`sessionStorage\` throw: a page that keeps state wraps them in \`try\`. Where the card does not reach — a report to another agent, a message sent elsewhere —
give the URL. Then stop, unless the user asked for the motion as a video: its export follows, as
the motion skill teaches. Do not open, render or screenshot a document page — no headless Chrome,
no Playwright, no other way of looking at it. A motion — a page declaring a timeline — is checked by
its frames with \`read_artifact_frames\` before publishing, as the motion skill teaches.`;

export type PublishingContext = { readonly thread: { readonly id: string }; readonly world: ThreadWorld };

const publishedClaims = (
  files: Layer.Layer<FileSystem.FileSystem> | undefined,
  named: string,
): Effect.Effect<readonly Claim[], ToolFailed> => {
  const source = isAbsolute(named) ? named : resolve(process.cwd(), named);
  const canonical =
    files === undefined
      ? Effect.succeed(source)
      : resourcePath(source).pipe(
          Effect.provide(files),
          Effect.mapError(
            (error) => new ToolFailed({ reason: `${source} could not be resolved: the filesystem answered ${error.reason._tag}.` }),
          ),
        );
  return Effect.map(canonical, (path): readonly Claim[] => [
    { on: { kind: 'file', path }, access: 'read' },
    { on: { kind: 'key', key: `artifact:${path}` }, access: 'write' },
  ]);
};

export function artifactSkill<TContext extends PublishingContext>(store: ArtifactStore['Service']): AgentSkill<TContext> {
  return {
    id: ARTIFACT_SKILL_ID,
    description:
      'Write a page this server hosts — a report, a dashboard, a plan, anything worth looking at rather than scrolling past in a transcript. Carries the design contract and the tool that publishes.',
    instructions: () => DESIGN,
    tools: (ctx) => ({
      [PUBLISH_TOOL]: Tool.make({
        approval: ASKS_NEVER,
        claims: (input) => publishedClaims(ctx.world.world.files, input.path),
        description:
          'Publish an HTML file this server already holds on disk and answer its URL and the address of this version. The file path is the identity: the same path published again replaces the page at the same URL and keeps the version before it. A page declaring a `tagma-timeline` is answered with that timeline; a declaration out of bounds publishes the page as a document and `timelineProblem` says what to fix.',
        parameters: Schema.Struct({
          path: Schema.String.annotate({
            description: 'The file to publish. Relative paths resolve against the server process, so write an absolute one.',
          }),
          title: Schema.optional(Schema.String).annotate({
            description: "The page's name in listings. Omitted, its own <title> is read.",
          }),
          description: Schema.optional(Schema.String).annotate({
            description: 'One sentence saying what the page is, shown under its name in listings.',
          }),
        }),
        display: ({ path }) => ({ form: 'none', title: path }),
        execute: (input, call) =>
          Effect.flatMap(callerThread(call.caller), (thread) =>
            store.publish({ ...input, thread: thread.threadId }).pipe(
              Effect.mapError((refusal) => new ToolFailed({ reason: `${refusal.reason} — ${refusal.unblock.join('; ')}` })),
              Effect.map(({ record, timelineProblem }) => {
                const published: PublishedPage = {
                  status: 'published',
                  id: record.id,
                  title: record.title,
                  description: record.description,
                  publishedAt: record.publishedAt,
                  url: record.url,
                  version: record.version,
                  versionUrl: versionAddress(record),
                  versions: record.versions,
                  timeline: record.timeline,
                  timelineProblem: timelineProblem ?? undefined,
                };
                return new ToolAnswer(published, {
                  form: 'none',
                  title: record.title,
                  facts: [
                    { label: 'url', value: record.url },
                    { label: 'versions', value: String(record.versions) },
                  ],
                });
              }),
            ),
          ),
      }),
    }),
  };
}
