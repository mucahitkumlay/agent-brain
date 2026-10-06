# Claude Brain

**Watch Claude Code work, live, on a real brain.** An Obsidian plugin that turns every Claude Code session —
its prompts, thinking, tool calls, subagents, workflows and results — into neural activity on an MRI-derived brain
with real gyri, deep nuclei and white-matter tracts. It only listens on your own machine and never calls a model, so it
uses no tokens.

![Claude Brain overview](docs/images/overview.png)

## What you see

- **Every action, where it belongs.** A tool call leaves the thalamus, travels along a real fibre bundle (HCP-1065
  atlas) and lights the gyrus for that kind of work: reading in the temporal lobe, editing in motor cortex, running
  commands in prefrontal cortex, web in the visual cortex, services in the cerebellum, subagents in parietal cortex.
  A shell chain like `git pull && npm ci && npm test` sends one signal per command. When the call finishes, the result
  travels back the same way.
- **Thinking that moves.** While a session deliberates, spikes keep circulating through prefrontal loops and the frontal
  surface flickers. Long-running commands keep their pathway busy until they finish.
- **The rest of Claude Code too.** Your prompt arrives through the auditory pathway, Claude's reply streams through
  Broca's area, permission requests light the amygdala and anterior cingulate, a finished task sends a small reward
  signal to the striatum, compaction plays hippocampal ripples, a new session wakes up from the brain stem.
- **A trace that stays.** Each action leaves a mark where it happened — on the gyrus, the nucleus and the fibre it used
  — coloured by the kind of work and fading with a half-life you choose. Click a gyrus to see what happened there.
- **Freeze time and look.** Press <kbd>Space</kbd>: every signal in flight stops. Point at one to see what it carries,
  click it for the whole operation tree of that turn (prompt → tool calls → subagents → their calls), with status and
  timing. Slow motion (0.1×, 0.25×) works too.

  ![Signal inspector](docs/images/signal-inspector.png)

- **Energy.** With Claude Code's telemetry on, every model call shows as a slow, warm response in prefrontal cortex
  (bigger with more output); context read from cache lights the hippocampus; each session shows its working memory,
  tokens and cost.
- **Is it stuck?** A command failing again and again, the same command re-run with nothing changed, a file edited
  over and over, API errors piling up, a command running for 20 minutes, or no progress for 10: the anterior cingulate
  pulses red and you get a notification.
- **MRI slices** through the ICBM152 template, with the fibres that cross the slice drawn like a diffusion map and
  live activity laid over grey matter like fMRI.

  ![MRI slice](docs/images/mri-slice.png)

- **EEG traces** per region, **sleep replay** of the last hours when everything is idle, **body signals** (CPU, memory,
  network, disk of each machine on the brain stem), your **vault as neurons** with links as synapses and connections
  learned from the files Claude uses together, and a **daily note** with what each session did.

## Install

**From Obsidian:** Settings → Community plugins → Browse → search "Claude Brain" (once it is listed).

**With BRAT:** add `mucahitkumlay/agent-brain` in the BRAT plugin.

**Manually:** download `main.js`, `manifest.json`, `styles.css` and the five `*.bin.gz` files from the
[latest release](../../releases/latest) into `<your vault>/.obsidian/plugins/claude-brain/`, then enable the plugin.

If the `*.bin.gz` anatomy files are missing (a plugin installed from the community list only gets the first three
files), the plugin downloads them once from the release that matches its version and checks their SHA-256.

Desktop only (it runs a small local HTTP listener).

## Connect Claude Code

In the plugin settings, **Claude Code hooks on this computer → Install**. This adds hooks for every Claude Code event
to `~/.claude/settings.json` (your other hooks stay; a backup is written next to it) and, if "Energy from telemetry" is
on, points Claude Code's OpenTelemetry log export at the plugin. Restart running Claude Code sessions.

Prefer to edit by hand? **Copy JSON** gives you the hook block. Everything goes to `http://127.0.0.1:27182` (the port is
a setting).

### Sessions on a server

Claude Code running on a remote machine reaches the plugin through a reverse SSH tunnel:

1. Start the tunnel on your computer: `scripts/tunnel/claude-brain-tunnel.sh user@server` (macOS/Linux) or edit
   `SERVER` in `scripts/tunnel/claude-brain-tunnel.bat` and run it (Windows). Key-based SSH login must already work.
2. On the server, once, while the tunnel is up: `curl -s http://127.0.0.1:27182/install.sh | sh`
   This installs the hooks, a small offline queue (events wait on disk while the tunnel is down and are replayed when
   it comes back), a link script that sends a heartbeat and the machine's body signals, and the telemetry settings.
3. Restart the tunnel and the Claude Code sessions on the server.

## Using it

| Key | |
|---|---|
| <kbd>Space</kbd> | Freeze time, inspect signals (<kbd>,</kbd> <kbd>.</kbd> slower / faster) |
| <kbd>S</kbd> <kbd>A</kbd> <kbd>T</kbd> <kbd>G</kbd> <kbd>E</kbd> | Sessions, activity, timeline (click to replay), regions, EEG |
| <kbd>L</kbd> <kbd>M</kbd> | Anatomy layers, MRI slice |
| <kbd>F</kbd> <kbd>R</kbd> <kbd>H</kbd> <kbd>I</kbd> | Follow activity, reset view, hide everything, numbers and shortcuts |

Click a session for its plan, agents, energy and recent events; a gyrus or nucleus for its memory; a note to open it.
The command palette has a demo (**Claude Brain: Play demo session**) if you want to see it without a real session.

## Privacy and network

- The listener binds to `127.0.0.1` only. The plugin never calls a model and sends nothing anywhere.
- The only network request is the one-time download of the anatomy files from this repository's GitHub release.
- Stored in the plugin's `data.json`: settings, the activity trace, short labels of what happened in each region (file
  names and program names, never command lines), learned file connections and today's counters. The timeline history
  stays in memory.
- The daily activity note (optional) is written into your vault.
- Prompt text, reply text and tool output are never stored. Claude Code's telemetry keeps prompts and replies redacted
  by default, and the plugin uses only counts and timings from it.

## Build from source

```sh
bun install          # or npm install
bun run build        # dist/main.js, manifest.json, styles.css
bun run test         # unit tests against dist/main.js
```

`dev/` has a browser harness that runs the plugin outside Obsidian (`node dev/prepare.mjs`, see the file).
`tools/anatomy/` rebuilds the anatomy data from public sources. See `CONTRIBUTING.md`.

## Credits and licences

Code: MIT. Anatomy data: ICBM152 2009 template (McConnell Brain Imaging Centre, MNI), AAL atlas (GIN-IMN),
HCP-1065 tractography atlas (F.-C. Yeh, CC BY-SA 4.0; data from the Human Connectome Project), via the
[niivue](https://github.com/niivue/niivue) project. Rendering: [three.js](https://threejs.org). Details and citations in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The brain mapping is a visual metaphor grounded in real anatomy, not a model of how a language model works, and not a
medical tool. Not affiliated with or endorsed by Anthropic; Claude and Claude Code are Anthropic's products.
