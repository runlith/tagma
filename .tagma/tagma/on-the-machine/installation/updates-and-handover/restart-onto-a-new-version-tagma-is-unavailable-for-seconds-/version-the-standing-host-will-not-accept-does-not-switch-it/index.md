---
id: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
title: "Version the standing host will not accept does not switch itself on: Tagma asks with a non-modal card carrying the price, and work stays on the current version"
ord: 13
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: relates
    to: 01a17d05-bec5-79d7-b369-2e3d99e0a462
---
**Why.** On 2026-10-27 updating Tagma Dev from 8f453f0 to head left the server without an execution host: the 8f453f0 host logic rejected the new bundle's manifest (the `terminals` role, fixed in 9e0e82c, [[99e0a462]]), yet the switch still happened. The new server (pid 5446) wrote at 11:36:10 "the standing host of another build refused this build's candidate and stays", and the window then showed raw `ActivationDeferred` rows, "the shell this act opened cannot be named", and 36 `acp drive` failures. Agent terminals and commands did not work until the operator rolled back. By design [[d86d6647]] a host refusal at prepare cancels the restart while the predecessor still serves, but the predecessor's log (pid 90978) holds no host-prepare line, and why the refusal did not stop the switch is undetermined. A host can refuse a new version for other reasons too: an incompatible candidate format, `executions.sqlite` migrations off the chain, holder checks. For every user this currently costs Tagma without terminals or agents.

**What will stand.** A version the standing host will not accept does not switch itself on and does not stop the person. Mockup: `http://localhost:5634/a/7567f1f2c4cc`.

- The check of whether the host will accept the candidate runs before the switch, while the current version works. A refusal restarts nothing: the current server and host serve with all executions, with no errors anywhere.
- The window puts a non-modal offer card on the notification stack (top right, `NoticeCards`): "Tagma 0.1.4 is ready", what will close on update, that work continues on the current version until then, `Update and end N` and `Later` buttons. The cross equals `Later`; `Later` hides this version's card, and a new version arrives as a new card. No modal dialog and no confirmation: the price stands on the button.
- The update waits in the "Tagma" chip (amber "update ready"), with the same finished-installation card carrying the price and the same button in its popover. A regular update the host will accept shows the same card saying terminals and agents will survive it.
- The price does not grow with the terminal count: only running programs are named (a terminal's foreground process, not the shell itself), at most three plus "N more"; empty shells and agent commands are counted. `Show all` opens the full grouped list in the card (Running, Agent commands, Idle shells), with a height limit; the same list stands in the Host popover row.
- `Update and end N` restarts Tagma on the new version with a new host: the old host's executions end, threads learn about their terminals as on host replacement, and each closed terminal's tab keeps its history and says it ended with the update that needed a new host.
- Tagma Dev: the question arrives in response to the pressed "Update" in the chip. Plain Tagma: when a new application version opens, the window opens on the working version, and the question stands as the same card instead of the `install-from` system dialog (`apps/tagma/desktop/src/main.ts:181`).
- If the new version's server already came up under another build's host that does not accept it (cold start after a server crash, interrupted handover), the window shows the same card: whose host holds the terminals, what will close, `Restart host and end N`, and `Open <version>` when the past installation still lies nearby. Raw `ActivationDeferred` texts and refusal toasts for terminal acts have no place in this state: the one card does.

**How.**
- The cause of today's switch is found by reproduction: tagma:try on a build whose host will reject the candidate (for example a manifest role its logic lacks), then updating onto it; the test is red first. The candidate decision belongs to the restart road (`SuccessionSteps.prepare`, `executions/host/departure.ts`), not the window. A published release is installed by an `install-from` attempt where `to` does not touch the host before its door ([[9e8adf53]]): the verdict is taken on the `from` side before the `current` shift.
- The server reports the finished installation in the machine state with a "new host needed" flag and the price: executions that will end, with kind (running program, empty shell, agent command), name, project, and holder. The "empty shell" kind comes from the host (the pty foreground process), never guessed by name.
- Restarting with a new host is a server act that finishes the standing host by the regular road (vacate or the recovery program of its bundle) and raises the host from the new version's bundle; `tellReplaced` notifies the threads.
- Window: the card is an offer-kind `NoticeCard` (grey square), the chip and popover are `StandingChip`. Interface words are English, without "·".
- Desktop: the `install-from` branch carrying the host question opens the window on the working release and hands the question to the surface, not to `dialog.showMessageBox`. Works starting with the release that carries it: a release without this code asks as before.

**Acceptance.**
- itest: a candidate the standing logic will not accept leads to no switch — the predecessor's server and host serve, executions stay alive, and the restart answer names the host refusal and the price. Before the fix the test is red on the 2026-10-27 scenario.
- itest: `Update and end N` finishes the named executions, raises the new version's host, threads get the replacement notification; a new terminal works after it.
- Window tests: the card names at most three running programs and counts the rest; `Show all` shows everything by group; closing equals `Later`, the update stays in the chip.
- Check on tagma:try: updating from a build to one whose host refuses — work is not interrupted, the card stands; after `Update and end N` the new version works with the new host.
