# Changelog

## 0.17.1
- The repository holds only the plugin and what builds, tests and releases it. The rules for changing the code (local only, watch never steer, one outgoing request, received content is data, nothing private on disk) are in CONTRIBUTING.md; security reports go through GitHub's *Report a vulnerability*. No change to the plugin itself.

## 0.17.0
- **Watchers you can act on.** The Watchers panel is a list of what is still open, sorted by how much it asks of you: *Needs you now* (a risky command, a secret in the open, outside content followed by a risky step), *Worth a check* (a claim that the check contradicts, a package that does not exist, a loop) and *For the record* (a file that is not there, an out-of-date picture of a file). Each card says what happened in plain words and **what to do**; the watcher's own sentences and the calls behind them are one click away under *What the watcher saw*.
  Findings that belong together are one card: what an agent did after reading one web page or download (with each step listed), the guard finding on the same call, and the same finding again in the same session (*3 times*).
  Each card has buttons: **Copy a message for Claude** (a short note of Agent Brain's own, such as "Your last check failed. Run it again and paste the output before you say it works", for you to paste into Claude Code; it never carries text the agent received), **Lessons for CLAUDE.md**, **Normal in this project**, and **Done**, which moves it to a *Done* list (kept while Obsidian is open). The strip in the corner counts only what is open (*2 need you*), and the notifications say what happened and what to do instead of repeating the watcher's raw sentence.
  The session panel shows the same cards for that session. What each watcher does, with its on/off switch, is at the end of the panel.
- **Use Claude Code better** measures two more things, per turn and week by week: how much of the context was read from the prompt cache (from the telemetry), and how many failed tool calls were tried again. When over ten turns less than half of the context came from the cache, a suggestion says so and what empties the cache (long pauses in the middle of a task, switching models).
- **A second opinion.** *Copy for a review* (in the panel, and in the command palette) puts the recorded numbers on the clipboard as text, with a short request for a review, to paste into a chat with any assistant: this week against the last, week by week, one row per turn of the last two weeks (durations, calls, failures, tests, context, cache, cost, kinds of warnings in words, yes/no prompt features), what you approved by hand, and what the panel already suggested. It holds no prompts, replies, code, command lines or file names; *Show what it contains* shows all of it first. A new setting hides project names ("project 1", "project 2"). Agent Brain sends nothing itself.

## 0.16.0
- Opening the view gives you more than a picture. A line at the top says in one sentence whether you need to act (an approval, a session that may be stuck, warnings) or that nothing needs you; click it to go there. When a turn ends, a card says what it did (tool calls, files, last test run, cost, warnings) and opens the turn report or the key moments. Before the first session, a start screen lets you try each part: watch made-up sessions, stop time on a call, see what the watchers catch, check the setup.
- **What can I do here?** A new panel (the ? button, or <kbd>?</kbd>) lists every part of Agent Brain in plain words, grouped by when you need it (while it works, watchers, after a turn, your vault), each with a button that opens or tries it. The dock has a Watchers button (<kbd>W</kbd>), and every dock button names itself as soon as you point at it.
- **Use Claude Code better** (new panel, the ↗ button or <kbd>U</kbd>). From your own turns of the last two weeks, worked out on this computer: this week against the week before (typical turn, time Claude waited for you, failed tool calls, warnings, cost per turn, how many code changes were tested), and suggestions that each show the numbers they rest on and what to do:
  the same harmless command approved again and again (with the permission rules to copy, never for risky commands), file edits approved one by one (accept-edits mode), "it works" without proof and changes without tests (a line to copy into CLAUDE.md, with the project's test command), the same wrong guesses (open the lessons), loops, a context over three quarters full (/clear, /compact), answers that rest on nothing, and the turns that cost the most. When everything is idle, the top line says how many suggestions there are.
  **Week by week**, over everything recorded (up to a year): a small line per measure from the first week to this one, green when it got better, red when worse, including how often you had to correct an answer.
  **Prompting suggestions**: how your prompts went, compared by a few yes/no features worked out when each prompt arrives (did it name a file, say what "done" looks like, was it very short, was it "fix it", was it a correction such as "no", "revert", "geri al"). For example: prompts that named a file were corrected 19% of the time, the others 36%. Shown only with enough prompts on both sides and a real difference.
  **CLAUDE.md per project**: lines to add, each from that project's own evidence (the test command that works, claims without proof, untested changes, lessons, loops), and a note when no CLAUDE.md was loaded there (/init creates one).
  It can be turned off, and its history cleared, in the settings. What is kept: one line of numbers per finished turn for four weeks, then one line of sums per week for a year: durations, counts, cost, kinds of warnings, the first words of commands you approved, the yes/no prompt features. Never the prompts themselves, file contents or paths. Demos are not counted.
- The watchers strip says what it is (*Watchers · 3 caught · what is this?*). Clicking a watcher or the title opens a panel that says in plain words what each one watches and why, lists what it caught across your sessions with the evidence, and can turn it off. Findings from the demo are marked *(demo)*. Watchers have a dock button and the <kbd>W</kbd> key.
- The first time real signals move, a hint says that each dot is one real call and that <kbd>Space</kbd> stops time so you can open it; *Stop time now* or *Got it*, and it does not come back.
- When everything is idle, the top line sums up the day: turns, cost and warnings.
- The brain's labels say what kind of work happens there (*Reading, searching*, *Writing, editing*) instead of the anatomical name, and note names no longer print over them. The timeline fits itself to the recent sessions (new *fit* button) instead of squeezing them into the last hour.
- The EEG traces are off for new installs (turn them on with <kbd>E</kbd>).
- Tried against a real Claude Code (2.1.293) on a test project, 15 real turns: edits, tests, a subagent, a web fetch, a risky delete, a correction. What that turned up is fixed:
  - a web fetch that failed because the network or a proxy refused it was reported as "an address that does not exist"; now only a 404 or an unknown host counts;
  - a lesson that stopped being true (a build script that was added later, a file that now exists, a command that now passes) is dropped instead of staying in the CLAUDE.md suggestions;
  - a correction ("no, revert …") in a resumed or continued session, which gets a new id, now counts against the turn it corrects in the same project;
  - a prompt that only mentions tests ("the tests are broken", "don't run the tests") no longer counts as saying what "done" looks like.
- Fixed: clicks on the session list, banners and watchers could be lost when the list refreshed (every second) between mouse down and mouse up.

## 0.15.0
- The four watchers are always in view. A strip under the session list shows Guard, Shield, Reality and Stuck, each with a dot while it is on and a count when it has caught something; click one to open the session and the evidence. A watcher you switched off in the settings is shown struck through. With nothing caught yet, **See it catch things** (also in the command palette) plays a made-up session in which all four fire.
- New setting, **Signal style** (Settings, before *Reduce motion*). *Realistic* is the default and follows what calcium
  imaging of a real brain shows: a cell lights up all at once when the signal reaches it and fades in about a second, and
  the axon carries only a small, faint wavefront. *Illustrated* keeps the earlier look, with a bright head, a longer
  trail and a slower fade, which is easier to follow when you want to read the path.
- The injection shield also recognises tags that spell a role with spaces or attributes (`</system >`, `<system role="admin">`), which fixes the code-scanning finding "Bad HTML filtering regexp".
- GitHub release notes are the text of this changelog for the version, with no commit list and no "Full Changelog" link.
- A new end-to-end test sends a realistic Claude Code session to the listener over a real socket and checks what the README promises (regions, shell chains, guard, shield, reality check, stuck alarm, turn report, refusal of web pages).
- New screenshots in the README, taken from this version; the README no longer carries migration notes for the old name.

## 0.14.0
- Signals go where the work went, and nowhere at random. When Claude uses a file right after another one, a signal now runs
  from the first to the second along the connection between them, and the second note lights up when the signal arrives.
  The glow of a note spreads only along connections that have really been used (the strongest first), no longer along any
  link of the note. Work that touches no note (a shell command, a web search) pulses its region and its pathway, and no
  longer lights random notes in that region. A folder search lights the same five notes every time. The "most connected"
  notes light when you send a prompt, instead of three at random. Only the decorative ambient flicker (off by default,
  and labelled as not real) is still random.
- A signal looks like a nerve impulse: a small bright head, and the stretch of axon it is passing through lights up and
  fades behind it. No more halo ring and no beads of light. Long axons take longer to cross than short ones.
- Axons are smoother (26 pieces per link instead of 14).
- The signal inspector says what a signal is: the next file in the order Claude used them, or a connection used before.

## 0.13.0
- Fixed: neurons and synapses stuck out of the brain. Some cell bodies sat on the wrong side of a thin fold, and their
  dendrites, axons and terminal twigs left the cortex with them. Now every cell body is placed under the surface, and
  dendrites, axons and twigs that would reach it turn and run just beneath it. Checked against the real brain surface:
  the points outside went from 295 to 5 of 51,030 (at most 0.36 mm, on the surface itself).

## 0.12.0
- Neurons and synapses look like the real thing. Every note is a cell with its own dendrites (one apical dendrite towards
  the cortex, several basal ones, each branching), tinted by its region. A link is an axon that leaves the cell body and
  runs the way real fibres do: short links as association fibres that dip under the cortex and follow its folds, long
  links through a real white-matter bundle from the anatomy data, otherwise a free curve that bends its own way. Each
  axon wobbles a little, thins along its length and ends in a few twigs with small swellings (boutons) at the receiving
  neuron. Signals travel along the same paths. Nothing is random between sessions: a link always runs the same way.
- New: **Reduce motion** (Settings; *Auto* follows your system). No auto-rotate, no following camera, no dreaming and no
  decorative flicker; real events still light up and travel because they are the data.
- New: step through travelling signals from the keyboard (<kbd>[</kbd> <kbd>]</kbd> or <kbd>P</kbd> <kbd>N</kbd>, which
  freeze time; <kbd>Enter</kbd> opens one). Works with AltGr layouts. The signal is described in words through a live region.
- New: **a note per session** (off by default): when Claude Code reports a session ended it gets its own note under
  `Sessions/`, with what it did that day, its cost, and `[[links]]` to the notes it worked with and back to the day. A
  session that is killed sends nothing; a command saves any session's note on demand. Your "My notes" part is kept.
  Notes are written one at a time and read through one helper only.
- New: **spending limits** per session and per day (off by default): one notice when a limit is passed. Never a stop.
- New: **export a replay as one web page**: the same scrubbed data as a replay file, as a single HTML file anyone can open
  in a browser (timeline by kind of work, play and scrub). It loads nothing, makes no requests and carries a policy that
  forbids everything but its own script.
- Fix: the daily note no longer grows at every refresh (it found the words "## My notes" in its own callout and copied the
  whole note below them). Text from outside (project folder, working directory, file names) is written as one plain line, so
  it cannot start a heading, callout, link or table cell.
- CI: a gitleaks secret scan (pinned) over the whole history on every push and pull request. Test fixtures that look like
  keys, including private-key headers, are built at run time.

## 0.11.1
- Fix: "Tests pass" is no longer claimed from a message that says the tests fail ("Tüm testler başarısız oldu" was
  read as a claim and accused as "ran no tests"). Claims now ignore failure reports, conditions and instructions
  ("make sure the tests pass"), understand Turkish, and catch more English forms ("everything passes", "all green",
  "0 failures", "42/42 passed").
- More commands count as running tests: `node test/run.mjs`, `node --test`, `npm t`, `python -m unittest`,
  `deno test`, `npx playwright test`, `./gradlew test`, `php artisan test`, `swift test`, `flutter test`,
  `Invoke-Pester`, `pwsh ./test.ps1`, `ctest`, `rake test` and more.
- Guard: far more risky commands, including Windows and PowerShell (`rmdir /s /q`, `del /s`, `Remove-Item -Recurse`,
  `irm | iex`, encoded commands), split flags (`rm -r -f`), `find -delete`, script one-liners, `git push +main` and
  `:main`, `git branch -D`, `docker compose down -v`, cloud deletes (aws, gcloud, az), `FLUSHALL`, `dropDatabase`,
  `npm unpublish`, `UPDATE` without `WHERE`, and risky lines inside a script the agent writes. Routine clean-ups of
  build folders and caches stay quiet.
- Secrets: passwords after `-p`, `--password` or `-u user:pass`, passwords in a URL, `DB_PASSWORD=`,
  `AWS_SECRET_ACCESS_KEY=`, `client_secret:`, npm, Hugging Face, GitLab, PyPI, Docker, SendGrid, Slack-webhook and
  storage-account keys, encrypted private keys. Masking now handles all of them, never changes text without a secret
  and is safe to apply twice.
- Shield: more sources count as untrusted (pull requests, tickets, pages, threads), more ways to send data out
  (Python and Node one-liners, `gh gist create`, `git remote add`, `aws s3 cp`, DNS), more ways to read secrets
  (`echo $TOKEN`, `Get-ChildItem Env:`, `kubectl get secrets`), more startup places (PowerShell profile, services,
  registry Run keys, git hooks), and injected text in more wordings and in Turkish.
- Shared replays no longer keep a program, subcommand, agent or tool name you chose yourself: only well-known programs
  and verbs, and fixed lists for the rest.
- New: mark a finding *This is normal here* to stop it for one project (undo in the settings); copy a turn report as
  text; a turn's cost is compared with the project's recent turns.
- Privacy and hardening: the server queue redacts secrets, cuts values and is readable by its owner only; the GPU name
  is stored as a hash; the demo page uses neutral names; CI checkouts no longer keep the git token; the vault's own
  `.claude` clean-up goes through Obsidian's file API; Node's `fs` is used in one function for one file, and the
  replay picker lists only the replay folder. `test/invariants.test.js` now checks the file, clipboard and vault
  rules. The Install step honours `CLAUDE_CONFIG_DIR`, like Claude Code does, and never overwrites its first backup.
- Housekeeping: the author and repository links no longer mention the old organisation name.

## 0.11.0
- Guard: destructive commands (rm -rf outside build folders, git push --force, reset --hard, clean -fd, DROP TABLE,
  DELETE without WHERE, terraform destroy, kubectl delete, curl | sh, chmod 777, …) and secrets on a command line or
  written into a file light orange and notify you. Nothing is stopped. Keys and tokens are masked in the inspector, the
  log, the timeline and the daily note.
- Injection shield: content from the web, search, email or issues followed by reading credentials, sending data out,
  dumping secrets or changing startup files, and content that addresses the agent ("ignore previous instructions").
- Evidence: each finished turn keeps what it rests on (files, searches, pages, commands), shown under "Based on". A long
  answer about specific files with nothing read or run is marked.
- Turn report: a time map of the tool calls, thinking time, time waiting for your approval, failures, retries, files
  changed and cost, in the session panel ("Last turn") and on the finished turn.
- Lessons per project (the test command that works, commands that are not installed, packages that do not exist,
  commands that keep failing), with "Copy for CLAUDE.md" and "Write to note".
- Session autopsy, shareable replays (exported without names, paths, prompts, addresses or secrets; "Play a replay
  file" plays one on your brain without touching your memory), comparison of two sessions, and a project map.
- Setup check (opens on the first run), themes (Night, fMRI, Match Obsidian, High contrast with Okabe-Ito colours).
- Other agents can post events to `/agent` (a small generic format, see the README).
- Coach mode, off by default: findings can go back to Claude Code as context on its next tool result. Never a decision.
- Fix: "Tests: 0 failed" no longer counts as a failed run.
- The demo uses made-up projects and files only: nothing from your vault or your computer appears in it.

## 0.10.0
- Reality check: signs that the agent believes something that is not so. A file, command, package, module, npm script,
  git path or web page that does not exist; an edit of text that is not in the file; a change to a file it has not
  read; code that uses a name its own search just found nowhere; and, at the end of a turn, "the tests pass", "the
  build works" or "fixed" when the last run failed or no test ran. Each finding sends a violet prediction-error signal
  into the insula and cingulate, is listed in the session panel with a link to its evidence, appears in the operation
  tree, and (for claims) notifies you. Settings → Alerts → Reality check.
- The demo shows a finding or two.

## 0.9.7
- Smooth zooming: the wheel sets a target and the camera eases to it, so zoom stays fluid even when frames are slow.
- Neurons and signals have a maximum size on screen: close up they used to grow to hundreds of pixels each, with
  additive blending, which made zooming in very heavy.
- Auto quality knows the GPU: it reads what kind it is (dedicated, integrated, software) to choose where to start,
  measures the real GPU time per frame where the browser allows it, and keeps a quality at which dragging and
  zooming run at 60 fps (stepping back up, at most once a minute, when there is plenty of room). Without a GPU
  (software rendering) the glow is turned off.
- While you drag or zoom, a GPU that cannot keep 60 fps gets an even 30 instead of a stuttering rate.
- The composer's unused second buffer is kept at 1×1 pixel: less video memory.
- The Info panel (I) shows the GPU, the render scale, the antialiasing and the GPU time per frame.

## 0.9.6
- Fixes the fast flicker in 0.9.5: the post-processing swapped its two buffers after every frame, and only one of them
  was antialiased, so every other frame came out with jagged edges. The scene now always goes into the same
  multisampled buffer.

## 0.9.5
- Much lighter on the GPU:
  - Adaptive frame rate (new default): 60 fps only while you drag, zoom, replay or inspect; 30 fps for the slow ambient
    motion; 20 fps while Obsidian is in the background; never above 60 on 120/144 Hz screens.
  - Only the scene buffer is multisampled (the second buffer and the canvas no longer are), which halves the video
    memory; the bloom runs at half its former resolution.
  - Spike buffers upload only the points in use each frame.
  - Auto quality starts at 1.5x at most, drops the antialiasing before the resolution, and remembers where it settled.
- No more blinks: opening a panel or changing quality no longer clears the canvas for a frame, and auto quality no
  longer steps up and down (each step reallocated the buffers).
- If the GPU drops the WebGL context (driver reset, out of video memory), the view rebuilds itself when it comes back.

## 0.9.4
- First release built by GitHub Actions from `package-lock.json`, with build-provenance attestations. Same plugin as
  0.9.3.

## 0.9.3
- Releases carry only `main.js`, `manifest.json` and `styles.css`. The anatomy files moved to their own release
  (`anatomy-1`), still downloaded once and checked by SHA-256.
- Built with esbuild from a lockfile (`npm ci && npm run build`), so anyone can rebuild a release and compare; releases
  are built by GitHub Actions and carry build-provenance attestations.
- `LICENSE` is the plain MIT text again, so GitHub and the plugin directory recognise it; the scope notes (data in
  `assets/`, trademarks) are in `THIRD_PARTY_NOTICES.md` and the README.
- Styles: no `!important`, no CSS masks, no scrollbar styling (all flagged by the directory's checks).
- README: a disclosures table (network, local server, files outside the vault, vault files, clipboard).

## 0.9.2
- Sharper picture: the scene is now drawn with 4x multisample antialiasing (the canvas's own antialiasing never applied,
  since everything goes through the bloom pass), so gyri, fibres and outlines no longer show jagged edges.
- Auto quality starts at your screen's full resolution, never drops below it (it used to go down to 0.8x, which looked
  blurry and blocky), and steps back up once frames are fast again. New "Maximum" setting: above screen resolution
  with 8x antialiasing.

## 0.9.1
- The project now lives at https://github.com/mucahitkumlay/agent-brain (the old address redirects). The anatomy files
  are fetched from releases there.
- CI uses only GitHub's own actions (Bun comes from npm), with read-only permissions for the test workflow.

## 0.9.0
- Renamed from Claude Brain to **Agent Brain** (plugin id `agent-brain`). It works with Claude Code for now; the name
  no longer uses Anthropic's trademark. Settings carry over when you move `data.json` (see the README).
- Listener hardening: requests that look like they come from a web page (web `Origin`, `Sec-Fetch-Site`, a foreign
  `Host` from DNS rebinding) are refused.
- Security invariants checked by tests.
- README: responsible use, a per-file licence table, redistribution duties, trademarks, no-warranty and not-medical
  notes. The release `main.js` carries a licence banner.
- Call inspector: click a signal (or an event in a session) for everything about that call: every parameter, who ran
  it (main agent or subagent, the agent chain and the call that started it), why (its description, what Claude said just
  before, the plan step, the agent's task, your prompt), where it goes (files, URLs, hosts, MCP server, each program of a
  pipeline, files it writes) and where it lands in the brain and why, its output and the raw hook events, with copy
  buttons. Kept in memory only; Settings → Inspector turns it off.
- The operation tree is a tab of the inspector; click a line for its details, ↻ to replay it.
- Atlas look (V, or the layers menu): a see-through brain where neurons, synapses and signals stand out, tinted by region.
- The hover tip shows the command or path a signal carries.
- Demo calls carry ids, prompts and output, so the inspector has something to show.
- Settings: headings use Obsidian's setting headings; README states network use and the one file outside the vault.

## 0.8.0
- Freeze time (Space) and slow motion; point at any signal to see what it carries, click it for the operation tree of
  its turn; replay any line of the tree.
- Energy from Claude Code telemetry (OpenTelemetry logs): model calls, tokens, cache, cost, working memory.
- Stuck detection: repeated failures, re-running unchanged commands, edit loops, API errors, long-running commands,
  no progress.
- Sleep replay when idle; EEG-style traces per region; region memory (click a gyrus or nucleus).
- Anatomy rebuilt from the ICBM152 2009 template only (T1 slices and ventricles).

## 0.7.0
- All Claude Code hook events; signals travel along real fibre bundles; one signal per command of a shell chain;
  results travel back; thinking loops; engram trace; MessageDisplay (Broca's area); body signals (CPU, memory, network,
  disk); MRI slices with diffusion-style fibres; installer for local hooks.

## 0.6.0
- Full anatomy: AAL gyri, deep nuclei and ventricles, HCP-1065 tracts, MRI slices.

## 0.5.x and earlier
- Live view of sessions, subagents and workflows; timeline with replay; daily note; learned connections; servers through
  an SSH tunnel with an offline queue; minimal HUD; mini view.
