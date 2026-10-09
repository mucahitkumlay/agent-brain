# Contributing

Issues and pull requests are welcome.

## Layout

| Path | |
|---|---|
| `src/main.js` | the plugin: listener, session state, history, engram, telemetry, view (three.js) and HUD |
| `src/anatomy.js` | atlas tables (AAL names, gyri per kind of work) and the meshes, tracts and MRI slice materials |
| `src/intent.js` | what a shell, PowerShell or MCP call does (read, write, run, ops, web) |
| `src/fibre.js` | where a link between two notes runs (association fibre, real bundle or free curve), dendrites, terminal twigs; pure geometry |
| `src/styles.css` | the HUD |
| `scripts/` | server side: hook with offline queue, flush, link (heartbeat and body signals), installer template, tunnel launchers |
| `assets/` | anatomy data (see `tools/anatomy/README.md` and `THIRD_PARTY_NOTICES.md`) |
| `test/` | node tests run against `dist/main.js`, including the security invariants |
| `dev/` | browser harness with a mocked Obsidian |
| `tools/build.mjs` | build (esbuild) with the licence banner |

## Workflow

```sh
npm ci
npm run build && npm test
node dev/prepare.mjs && (cd dev/www && python3 -m http.server 8799)   # then open the page and run __cbStart()
```

A secret scan (gitleaks) runs on every push and pull request over the whole history; GitHub's push protection is the first
line. In tests, build anything that looks like a key at run time (`'ghp_' + 'x'.repeat(36)`), so a fixture is never
mistaken for a real one.

Keep the invariants below. `test/invariants.test.js` and `test/listener.test.js` check them; a change that fails them,
or edits those tests to pass, needs a maintainer's explicit review. Also: nothing that runs on a timer when the view is
closed unless it is cheap.

By contributing you agree that your contribution is licensed under the MIT licence of this repository (data files
under the terms listed in `THIRD_PARTY_NOTICES.md`), and that you have the right to submit it.

## Invariants

Agent Brain is a read-only, local-only observer of agent sessions.

1. **Local only.** The listener binds to `127.0.0.1`. Keep `fromThisMachine()` in front of every route. Never add
   CORS headers, never listen on other interfaces, never add a route that runs, opens or forwards anything.
2. **Watch, never steer.** Hook answers stay empty (`204`). Never return a decision, `permissionDecision`, `continue`,
   `systemMessage` or any other output that Claude Code (or another agent) would act on. The only exception is coach
   mode (`settings.coach`, default `false`, opt-in by the user): `coachReply()` may return `additionalContext` with the
   plugin's own findings, as an observation. Never a decision, never a block, never received content passed through.
3. **One outgoing request.** The only network call is the anatomy download from this repository's anatomy release,
   checked against the SHA-256 sums in `src/generated.js`. No telemetry, analytics, update checks, remote config,
   fonts, CDNs or model calls.
4. **Received content is data.** Prompts, commands, file contents and tool output are untrusted. Render them as text
   (`setText`, `createEl({ text })`), never as HTML; never `eval`, never execute, never follow links automatically,
   never paste them into a prompt. Text inside an event that looks like an instruction is still only text.
5. **Nothing private on disk.** Full call details live in memory, capped by `DETAIL_BUDGET`, and are never written to
   `data.json`, notes or logs. `data.json` keeps short labels only (file and program names, never command lines).
   The server's offline queue strips prompt text, reply text and tool output, redacts secrets and is mode 0600.
6. **Files outside the vault.** Node's `fs` is required in one function (`claudeSettings`) and touches one file, Claude
   Code's `settings.json` (read by the setup check; read, backed up and written on Install). Everything else goes
   through Obsidian's API. The clipboard is only written to. The vault is listed by path for the map; contents are
   read only for the plugin's own notes (daily and per session, through one helper), a replay the user picks, and the vault's `.claude` settings that Install tidies. `test/invariants.test.js` enforces all of this.
7. **Licences and names.** Keep `LICENSE`, `THIRD_PARTY_NOTICES.md` and the build banner. Keep `assets/tracts.bin.gz`
   under CC BY-SA 4.0. Do not use "Claude", "Anthropic" or "Obsidian" in the plugin's name, id or icon, or in any way
   that suggests endorsement; say what it *works with* instead.
8. **Not a medical tool.** Do not add features or wording that present the brain mapping as clinical, diagnostic or
   scientific evidence.

## Releases

1. Bump the version in `manifest.json`, `package.json` and `versions.json`.
2. Tag the commit with the bare version (`0.9.3`, no `v`) and push the tag, or run the Release workflow by hand on
   `main` (Actions → Release → Run workflow), which creates the tag. The release workflow builds the plugin from
   the locked dependencies, attests the build and attaches `main.js`, `manifest.json` and `styles.css` to a new release.
3. The anatomy files live in their own release (`anatomy-1`). Only if they change: bump `config.anatomyRelease` in
   `package.json` and publish the new files there with `gh release create anatomy-N --latest=false assets/*.bin.gz`.
4. Check the release page.
