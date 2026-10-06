#!/bin/sh
# Claude Code hook -> Agent Brain (through the SSH tunnel).
# If the tunnel is down, the event is kept in a small queue and sent when it comes back.
Q="$HOME/.claude/brain-queue.ndjson"
P=$(cat)
code=$(printf '%s' "$P" | curl -s -m 1 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H "X-Brain-Source: $(hostname)" --data-binary @- http://127.0.0.1:27182/event 2>/dev/null)
if [ "$code" != "204" ]; then
  size=0; [ -f "$Q" ] && size=$(wc -c < "$Q")
  if [ "$size" -lt 20000000 ]; then
    # drop the bulky / private fields (tool output, prompt text) before keeping it on disk
    line=$(printf '%s' "$P" | python3 -c 'import sys,json
try:
  d=json.loads(sys.stdin.read())
except Exception:
  sys.exit(1)
for k in ("prompt","last_assistant_message","display_content","accumulated_text"): d.pop(k,None)
r=d.get("tool_response")
if r is not None:
  r=r if isinstance(r,str) else json.dumps(r)
  d["tool_response"]=r[:300]
for c in d.get("tool_calls") or []:
  if isinstance(c,dict) and "result" in c:
    v=c["result"]; v=v if isinstance(v,str) else json.dumps(v); c["result"]=v[:300]
print(json.dumps(d,separators=(",",":")))' 2>/dev/null) || exit 0
    ( flock 9; printf '%s\t%s\n' "$(date +%s%3N)" "$line" >> "$Q" ) 9>"$Q.lock"
  fi
fi
exit 0
