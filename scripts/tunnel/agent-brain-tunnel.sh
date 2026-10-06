#!/bin/sh
# Agent Brain tunnel (macOS / Linux). Keeps a reverse SSH tunnel to your server open, so Claude Code sessions
# running there can reach the plugin on this computer, and reconnects when it drops. Ctrl+C to stop.
#
#   ./agent-brain-tunnel.sh user@your-server
# On the server, once, while the tunnel is up:  curl -s http://127.0.0.1:27182/install.sh | sh
SERVER="${1:?usage: $0 user@host}"
PORT="${2:-27182}"
while :; do
  echo "[$(date '+%F %T')] connecting to $SERVER ..."
  ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R "$PORT:127.0.0.1:$PORT" "$SERVER" \
    "test -f ~/.claude/brain-link.sh && exec sh ~/.claude/brain-link.sh || exec sleep 2147483647"
  echo "[$(date '+%F %T')] tunnel closed, reconnecting in 5 seconds"
  sleep 5
done
