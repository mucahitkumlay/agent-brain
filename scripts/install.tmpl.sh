#!/bin/sh
# Agent Brain server setup: hook script with offline queue, flush and heartbeat link, and the Claude Code hooks.
# Served by the Obsidian plugin through the tunnel:  curl -s http://127.0.0.1:27182/install.sh | sh
set -e
D="$HOME/.claude"
mkdir -p "$D"
cat > "$D/brain-hook.sh" <<'CB_EOF'
@@HOOK@@
CB_EOF
cat > "$D/brain-flush.sh" <<'CB_EOF'
@@FLUSH@@
CB_EOF
cat > "$D/brain-link.sh" <<'CB_EOF'
@@LINK@@
CB_EOF
chmod +x "$D/brain-hook.sh" "$D/brain-flush.sh" "$D/brain-link.sh"
python3 - <<'CB_EOF'
import json, os, shutil, socket
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p)) if os.path.exists(p) else {}
if os.path.exists(p): shutil.copy(p, p + ".bak")
cmd = 'sh "$HOME/.claude/brain-hook.sh"'
# reply text streams in chunks (MessageDisplay): sent straight through, in the background, never queued
speak = "curl -s -m 1 -o /dev/null -H 'Content-Type: application/json' -H 'X-Brain-Source: %s' --data-binary @- http://127.0.0.1:27182/event || true" % socket.gethostname()
h = s.setdefault("hooks", {})
mine = lambda x: "27182/event" in (x.get("command", "") + x.get("url", "")) or "brain-hook.sh" in x.get("command", "")
TOOLS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"]
PLAIN = ["SessionStart", "UserPromptSubmit", "UserPromptExpansion", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Notification",
         "Stop", "StopFailure", "SessionEnd", "PostToolBatch", "TaskCreated", "TaskCompleted", "InstructionsLoaded", "CwdChanged", "DirectoryAdded",
         "ConfigChange", "Elicitation", "ElicitationResult", "PreModelSwitch", "PostModelSwitch", "TeammateIdle"]
for ev in TOOLS + PLAIN + ["MessageDisplay"]:
    keep = [g for g in h.get(ev, []) if not any(mine(x) for x in g.get("hooks", []))]
    if ev == "MessageDisplay":
        g = {"hooks": [{"type": "command", "command": speak, "async": True}]}
    else:
        g = {"hooks": [{"type": "command", "command": cmd, "timeout": 5}]}
        if ev in TOOLS: g = {"matcher": "*", **g}
    h[ev] = keep + [g]
# Claude Code telemetry (model calls, tokens, cost) through the tunnel too; left alone if it already goes elsewhere
env = s.setdefault("env", {})
mine_ep = lambda v: "127.0.0.1:27182/v1/logs" in str(v or "")
elsewhere = (env.get("OTEL_EXPORTER_OTLP_ENDPOINT") and not mine_ep(env.get("OTEL_EXPORTER_OTLP_ENDPOINT"))) or \
            (env.get("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") and not mine_ep(env.get("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"))) or \
            (env.get("OTEL_LOGS_EXPORTER") not in (None, "otlp"))
if not elsewhere:
    env.update({"CLAUDE_CODE_ENABLE_TELEMETRY": "1", "OTEL_LOGS_EXPORTER": "otlp", "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL": "http/json",
                "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT": "http://127.0.0.1:27182/v1/logs", "OTEL_LOGS_EXPORT_INTERVAL": "1000"})
    env.setdefault("OTEL_METRICS_EXPORTER", "none")
    print("Agent Brain: telemetry (model calls, tokens, cost) goes to the brain as well")
else:
    print("Agent Brain: telemetry already goes elsewhere, left alone")
json.dump(s, open(p, "w"), indent=2)
print("Agent Brain: hooks for %d events updated in %s (backup: settings.json.bak)" % (len(TOOLS) + len(PLAIN) + 1, p))
CB_EOF
echo "Agent Brain: scripts installed in $D. Restart your Claude Code sessions so they load the new hooks, and restart the tunnel so the new link script runs."
