#!/bin/sh
# Sends events queued while the tunnel was down. Safe to run often; does nothing when the queue is empty.
Q="$HOME/.claude/brain-queue.ndjson"
[ -s "$Q" ] || [ -s "$Q.sending" ] || exit 0
(
  flock -n 8 || exit 0
  ( flock 9
    if [ -s "$Q.sending" ]; then cat "$Q" >> "$Q.sending" 2>/dev/null; rm -f "$Q"; else mv "$Q" "$Q.sending" 2>/dev/null; fi
  ) 9>"$Q.lock"
  [ -s "$Q.sending" ] || exit 0
  code=$(curl -s -m 60 -o /dev/null -w '%{http_code}' -H 'Content-Type: text/plain' -H "X-Brain-Source: $(hostname)" --data-binary @"$Q.sending" http://127.0.0.1:27182/batch 2>/dev/null)
  if [ "$code" = "204" ]; then rm -f "$Q.sending"; fi
) 8>"$Q.flush.lock"
