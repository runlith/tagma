import type { AgentSkill } from '@runlith/agent/AgentSkill';
import { STAGE_ELEMENT, TIMELINE_DECLARATION, TIMELINE_FRAGMENT } from '../../artifacts/contract/wire/fragment.js';
import { LONGEST_SECONDS, SIDE_PIXELS, TIMELINE_ELEMENT, TIMELINE_FPS } from '../../artifacts/contract/wire/timeline.js';

export const MOTION_SKILL_ID = 'motion';

const instructions = (publishing: boolean) => `# Making a motion

A motion is one HTML page whose picture is a function of time: an intro, a logo sting, an animated chart, an explainer. Tagma plays it under its own player in the thread, captures any of its frames on the server and exports it to MP4. All three draw frame k at t = k / fps from the same file, so a page that breaks the contract below shows the reader one thing and exports another.

${
  publishing
    ? 'Load **artifacts** too: its design and publishing rules apply to the page, and it carries `publish_artifact`.'
    : 'Publishing is switched off here: write the page as a standalone HTML file in scratch and give the reader its absolute path.'
}

## The file

Declare the timeline in \`<head>\`, statically, as JSON:

\`\`\`html
${TIMELINE_DECLARATION}
\`\`\`

- \`fps\` is one of ${TIMELINE_FPS.join(', ')}; \`duration\` is in seconds, at most ${LONGEST_SECONDS}; \`width\` and \`height\` are even, ${SIDE_PIXELS.minimum}–${SIDE_PIXELS.maximum}. A declaration out of bounds publishes the page as a plain document, and the publish answer's \`timelineProblem\` says what to fix.
- Lay the whole scene out inside \`<div id="${STAGE_ELEMENT}">\` at exactly \`width\`×\`height\`, in px. The fragment scales the stage to whatever frame shows it, so wrapping and sizes match between a 600 px card and a 1920 px export. Never size by the viewport: no \`vw\`, \`vh\`, percentages of the window or media queries.
- Define \`window.render = (t) => { … }\`: draw the frame at \`t\` seconds. Return a Promise if a frame must wait for something.
- End \`<body>\` with this fragment, verbatim, after the stage:

\`\`\`html
${TIMELINE_FRAGMENT}
\`\`\`

The fragment scales the stage, runs \`render(t)\` for each seek in order, pauses every CSS animation at \`t\`, reports readiness once fonts and images have loaded, answers the player, and plays the page on its own clock only when it is opened alone, until the first seek. Write only the declaration, the stage and \`render\`.

## Rules the capture depends on

- A frame is a function of \`t\` alone. No \`Date.now\`, \`performance.now\`, \`setTimeout\`, \`setInterval\` or \`requestAnimationFrame\` drives the picture, and randomness comes from a seeded generator (mulberry32 with a fixed seed per element). The server seeks frames out of order and in several tabs at once.
- One theme, every color explicit. Never read \`prefers-color-scheme\`: a dark app and a headless capture must draw the same frame.
- Fonts and images only as \`data:\` URIs: a base64 \`@font-face\`, \`<img src="data:…">\`, inline SVG. Only the animation libraries below come from a CDN; a fetched font or picture can be missing or late in a server capture, and the export would then differ from the card.
- No \`localStorage\`, \`sessionStorage\` or cookies: the player frame is sandboxed without its own origin and they throw there. No \`fetch\`, workers, \`<video>\` or \`<audio>\`.

## What can be rewound

- **CSS \`@keyframes\`**: place each animation on the timeline with \`animation-delay\` (seconds from 0) and \`animation-duration\`, with \`animation-fill-mode: both\`; the fragment pauses them and sets their time to \`t\`. CSS transitions have no place on a timeline — the fragment jumps them to their end — so use keyframes.
- **GSAP** (cdnjs or jsdelivr): one \`gsap.timeline({ paused: true })\`, and \`window.render = (t) => tl.seek(t, false)\`.
- **Lottie** (lottie-web from cdnjs): the animation JSON inline as \`animationData\`, \`renderer: 'svg'\`, \`autoplay: false\`. Lottie draws nothing until its own load ends, which the fragment does not wait for, so \`render\` waits for it: \`const loaded = new Promise((done) => (anim.isLoaded ? done() : anim.addEventListener('DOMLoaded', done)))\` and \`window.render = async (t) => { await loaded; anim.goToAndStop(t * 1000, false); }\`.
- **SVG** for marks, letters and line drawing (\`stroke-dasharray\` / \`stroke-dashoffset\`), **Canvas** for particles and fields — computed from \`t\` in \`render\`.

## Building it

1. Storyboard before geometry: scenes with their start and end times, one idea per scene, the words on screen.
2. Timing: hold text at least as long as it takes to read (about 0.3 s a word, never under 1.5 s), leave a 0.3–0.6 s beat between scenes, and end on a held final frame: the player stops there.
3. Easing: ease-out on entrances, ease-in on exits, linear only for constant drift.
4. Then geometry and style: px positions on the stage and a small token system of color and type, as the artifacts skill asks.

## The user's material

- An attached picture arrives in the message with the path it is kept at: read it from there. Raster (PNG, JPEG, WebP) goes in as a base64 \`data:\` URI; an SVG goes in inline, keeping its paths so they can move. An animated GIF or WebP plays on its own clock, which no seek reaches: use one still frame of it.
- With nothing attached, look in the project: logo and brand files (\`logo*\`, \`brand*\`, SVGs under assets, public or static), the fonts it ships (\`*.woff2\`, \`*.ttf\`), its colors in CSS variables or the Tailwind config.
- When the piece depends on material you cannot find, such as a logo intro without a logo, ask the user for it instead of inventing a brand.

## Look before you deliver

Call \`read_artifact_frames\` with the draft's path and the key frames — the first, each scene at its peak, the last; at most 12 — and look at every one: clipped or overlapping text, a fallback font (the \`data:\` font did not load), an empty stage, two frames that should differ but do not. Fix and look again. The check publishes nothing and adds no card. An answer \`page-failed\` carries the page's own exception: fix that first.
${
  publishing
    ? `
Then publish the draft path with \`publish_artifact\`. In a Tagma thread the reader sees it as a card with the player; there is no need to repeat the link there.

## Delivering an MP4

Only when the user asked for a video file: call \`export_artifact_video\` with the published page's \`id\` (\`scale: 2\` for twice the declared pixels). It answers at once with the job, and the card shows its progress. Calling again with the same page, version and scale joins the job under way, or answers the finished video with its address and the file it is kept in; give the user that address. \`cancel_artifact_video\` with the job stops it. The video belongs to that version: republishing the page needs a new export.`
    : ''
}
`;

export function motionSkill<TContext>(publishing = true): AgentSkill<TContext> {
  return {
    id: MOTION_SKILL_ID,
    description: `Make a motion: an animation written as code that Tagma plays in the thread and exports to MP4 — an intro or logo sting, an animated chart, an explainer clip, any "animate this" or "make a video of this" request. Carries the ${TIMELINE_ELEMENT} contract, the rewindable tools, how to use the user's own logo, fonts and colors, and the frame check before delivery.${publishing ? ' Works together with the artifacts skill.' : ''}`,
    instructions: () => instructions(publishing),
  };
}
