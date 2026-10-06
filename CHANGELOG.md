# Changelog

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
