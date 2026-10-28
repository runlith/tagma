import type { AgentSkill } from '@runlith/agent/AgentSkill';

const instructions = (publishing: boolean) => `# Showing how something works

When the reader asks how a feature, flow or product works, show them. Run the real thing in isolation, drive it through a realistic scenario, capture every meaningful state, check each frame, and ${publishing ? 'publish' : 'write'} one page that tells the story in pictures with short captions. A page of real screens answers "how does it work" better than any explanation, and it surfaces the defects that prose hides.

${
  publishing
    ? 'Load **artifacts** too: its design and publishing rules apply to the page.'
    : 'Deliver the page as a standalone HTML file in scratch, and give the reader its absolute path.'
}
What follows is what makes a showcase different: the isolated run, the capture and the frame discipline.

The subject can be anything: a web app, a desktop app, a CLI, a library, a service with no UI of its own. Nothing here assumes any particular product.

## 1. Decide the story before touching anything

- Name the reader's question in one sentence, and the claims the page must prove. For example: "a finished branch merges from the dialog, and archiving keeps the branch."
- Write a **shot list**: steps in story order, and for each step the state the reader must see and the act that produces it. Shoot in this order. A frame taken after a later state already exists cannot show an earlier moment honestly.
- Plan 1–3 frames per step: before, in flight and settled only when the change itself is the point. About 30 frames is the ceiling for one page; past that the reader stops looking.
- Choose the subject's configuration from those claims. A setting or input the page will talk about must be set on purpose, never left to whatever a default happened to be.

## 2. Isolate: never demo on the reader's own instance, data or repository

- Run a **separate instance** from the working tree, with its own port, its own state directory and its own install. Prefer the project's own "run beside" or preview script if it has one, and read its flags: such scripts sometimes register the real workspace by default.
- Put a dev server or proxy in front only when the UI needs one, on an explicit free port that fails rather than drifts (\`--port N --strictPort\` for Vite), pointed at that instance.
- Drive the instance only through a small wrapper that sets its environment (home, port, config dir), so no command reaches the reader's own instance by accident.
- Make the **subject disposable**: a tiny fake project, repository, dataset or account in the temp directory, created by a script so it can be recreated. Give it real content: real files, a few commits, plausible names. Lorem and "test123" make every frame worse.
- **Smoke-test every dependency the scenario needs** before building the subject: network services, credentials, background workers, external tools. If one is unavailable, choose a path that avoids it and record the failure as a finding. Don't spend the run fighting the environment.
- After a false start, make a **fresh** subject rather than cleaning up the old one. Deleted items tend to leave records that later show up on screen.
- **Name everything** the demo creates. Raw ids, reused random names and "Untitled" in a frame read as defects even when they are only your laziness.

## 3. Drive state: operations for the background, the UI for the moment

- Create the background through the product's own API, CLI or operations: records, commits, slow jobs, anything the frame is not about. It is faster, repeatable and exact.
- Perform through the UI **the act a frame is about**, in the same script that shoots it. Only a UI act shows the in-between states the reader needs to see: a placeholder, a spinner, a confirmation.
- Use the product's own reads (API listings, logs, the database through its door, git) as **ground truth** for captions and for deciding whether a screen is wrong.
- **Poll the real state before you shoot.** A command that reports "done" may have returned before the work finished.
- Set sticky state (server-side preferences, remembered views, feature flags) explicitly in every script. A fresh browser profile does not reset what the server remembers.
- Keep any single wait under about a minute. Split long waits into polls, and verify the effect before repeating an act.

## 4. Capture

Capture in the **browser built into Tagma** when you hold its tools: the reader can watch the run beside the thread, and you bring no automation stack of your own.

- Open the subject with \`open_page\` in a profile of its own (\`create_profile\`), so sign-ins and storage start clean; delete the profile to reset it.
- \`emulate_page\` with device \`laptop\` (1440×900 at scale 2) and one \`scheme\` throughout: the reader's own if known, dark otherwise.
- Act with \`act_on_page\`: \`steps: [{action: "click", ref: "e12"}]\` uses a reference from \`snapshot_page\`; several steps run in order and stop at the first refusal or opened dialog. Use \`wait_for_page\` for the text or element a frame needs before shooting it.
- \`capture_page\` keeps the frame on the server and names its path. A page keeps only its last 20 captures and deletes them when it closes: copy each frame into scratch under its frame name right after the shot.

A sub-second state needs a burst that a sequence of tool calls cannot take, and an agent without the browser tools has none. There, use a headless browser (Playwright or equivalent) with a **persistent profile** in scratch, viewport 1440×900 at device scale 2:

- If the automation library's own browser build is missing, point it at an installed Chromium through \`executablePath\` rather than installing a new one.
- **One script per step**, each taking \`(page, shot)\`, run by a small runner that opens the context, calls the step, and on failure saves an \`_error\` frame and prints the message. Make each step idempotent against remembered UI state, so a retake is one command.

Either way:

- **Frame names**: \`NNx-what.png\` in story order, \`-0 … -9\` for bursts, and an \`x-\` prefix for evidence frames that will not go on the page. The page spec selects frames by name, so a retake replaces a file without touching the page.
- Record the text of the region each frame shows — from the snapshot, or \`innerText\` of the panel in a script. A log line is how you know what a frame shows without opening it.

**Settle before shooting.** Measured waits that worked:

| After | Wait |
| --- | --- |
| Navigation | the load (\`wait_for_page\` \`load\`, \`waitUntil: 'networkidle'\` in a script), then 1.5–3 s (live data over sockets arrives after it) |
| Opening a menu or popover | 400–600 ms |
| A dialog opening, a tab loading | 1.5–3 s |
| A server act the UI reflects | 2.5–4 s, or poll the reflected text |
| A dialog closing | at least 300 ms, or its fade ghost lands in the frame |

**Transient states** (under a second) are caught by bursting right after the act, then picking frames by the logged text:

\`\`\`js
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(110);
  await shot(\`03e-create-\${i}\`);
  console.log(i, (await page.locator('aside').innerText()).slice(0, 160));
}
\`\`\`

A burst also exposes inconsistencies between panels during a transition. Those are findings.

**Selectors that hold up** in a script; in the built-in browser a snapshot reference replaces them:
- Rows whose order moves: never by index. Filter by text, then find the control inside the row: \`locator('tr, [role=row]').filter({ hasText: name }).locator('[aria-label="…"]')\`.
- Icon buttons that \`getByRole('button', { name })\` misses: \`locator('[aria-label="…"]')\`.
- A control whose label changes with context: probe it in each context first. The probe prints every button's role, aria-label, text and box.
- Hover submenus: \`hover()\`, wait about 500 ms, then click.
- Long lists: \`scrollIntoViewIfNeeded()\` before the click.
- Confirm buttons disabled until a selection: select first, then match the changed label with a regex (\`/^Clean up \\d/\`).
- Checkboxes and folds: read the state (\`isChecked()\`, the content's visibility) and act only if needed. Toggling blind flips a remembered state the wrong way.
- Toasts and notifications over the subject: wait for them to fade or dismiss them before the shot.

**Small subjects**: pair the full frame with a 2× crop (\`capture_page\` of the element's reference; in a script \`locator.screenshot()\`, or \`clip\` from the element's bounding box) when the point is a chip, a badge or a line of text. Full window is the default; it keeps the reader oriented.

**Pointing**: when the subject is not obvious in a full frame, inject a temporary outline or a numbered callout on the element before the shot (a style on the element, removed after), instead of hoping the reader finds it.

## 5. Check every frame with eyes

A frame that "should" show something is not evidence. Two checks:

1. **While shooting**: the logged region text and the probe catch wrong *state*.
2. **After shooting**: someone opens **every** frame and looks. If your own tools cannot open images, hand the frames to a helper agent that can, read-only, with the shot list. Ask for a verdict per frame (usable / retake, and why) and a ranked list of problems. Run this check midway as well as at the end: a problem found early is cheaper to retake.

Things this check catches that logs never do: a toast over the button, a collapsed fold, a half-faded dialog, a frame out of story order, a raw id in a header, an empty panel, a crop cutting off the subject.

Then sort what it found:
- **Frame problems**: timing, framing, wrong state, overlays. Retake them.
- **Product problems**: the product itself shows something wrong. Keep the frame, and caption it as a defect with the evidence that contradicts it. Never retake a defect away: a showcase that hides what it found is a sales page.
- **Environment problems** (a dependency unavailable in the isolated run) go in their own list. They are not product defects until shown to be.

To give a defect an owner, walk the page for the odd element's \`outerHTML\`, then search the codebase for its class or text to find the component that renders it.

## 6. The page

${publishing ? 'The page follows the artifacts skill' : 'Keep the page self-contained'}: a standalone file, inline everything, design grounded in the subject, and both themes for the page chrome. On top of that, a showcase page has its own anatomy:

- **Opening**: the reader's question as the title, and one paragraph with the model they need to read the frames: the three to five concepts, in plain words.
- **Steps**: a vertical sequence of numbered nodes. Each step has a short title, a one-line lead saying what happens, and its frames with captions. On wide screens, put captions beside the frame (frame about 2/3, caption 1/3) so the eye goes image to words without scrolling. Below about 1000 px, stack them.
- **Captions**: one or two sentences in the reader's language. First what they see, with the UI's own words in bold. Then what it means. Honest about anything off.
- **Defects**: a warning aside on the step where one shows, with the reading that contradicts the screen. Then a numbered summary at the end with three separate groups: product defects, environment problems, and caveats (what the page does not prove).
- **Navigation**: a sticky table of contents of the steps (a side rail on wide screens, a collapsed bar on narrow ones) that marks the current step.
- **Zoom**: clicking a frame opens it full-size over a dimmed page (a \`<dialog>\` with the image), closed by click or Escape. The 2× frames are what make zoom worth having.
- **Frames**: sit them on a neutral mat matching their theme, with a thin border and a soft shadow. A dark UI on a white page glares.

**Images.** Inline frames as \`data:\` URIs, re-encoded as JPEG at about 1800 px wide and quality around 84; that is roughly 120 KB each and keeps a 30-frame page near 4 MB. Keep the PNGs in scratch for retakes. Generate the page from a small JSON spec (steps → frames → captions, defects) plus an HTML template, so a retake or a caption edit is a rebuild, not a hand edit of a 4 MB file. ${publishing ? 'Publish the same path again to keep the same URL.' : 'Rebuild the same file for a retake.'}

## 7. Clean up and report

- Stop the dev server and the isolated instance, delete the disposable subject and the browser profile, and archive helper agents.
- Say exactly what could not be removed, for example records the instance keeps with no deletion path.
- Report to the reader: the ${publishing ? 'page URL' : 'absolute page path'}, the scenario in one line, the product defects found (each naming its frame), and the environment problems.
- File confirmed product defects with their owner right away, naming the frame, if the project tracks work.

## What goes wrong most

- Shooting before the data arrived: an empty panel, a spinner, "No changes yet". Poll the reflected text.
- Shooting out of story order and trying to fake an earlier state. Reshoot in order.
- Letting the demo's own debris (unnamed items, leftovers of a false start) into frames.
- Retaking a real defect until it disappears.
- Believing a log line about a frame instead of looking at it.
`;

export function showcaseSkill<TContext>(publishing = true): AgentSkill<TContext> {
  return {
    id: 'showcase',
    description: `Show how something works on a page of screenshots: run the product in isolation, drive a realistic scenario, capture and check each frame, and ${publishing ? 'publish' : 'write'} one page with captions and the defects found. Load only when the reader asks for it: names this skill, or asks to be shown how something works in screenshots, a walkthrough or a demo. Checking your own change is not that request. ${publishing ? 'Works together with the artifacts skill.' : 'Deliver the page in scratch.'}`,
    instructions: () => instructions(publishing),
  };
}
