#!/bin/sh
# Claude Code hook -> Agent Brain (through the SSH tunnel).
# If the tunnel is down, the event is kept in a small queue and sent when it comes back.
umask 077   # the queue is readable by you only
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
import re
for k in ("prompt","last_assistant_message","display_content","accumulated_text"): d.pop(k,None)
# keys and passwords never go to disk, and no single value is kept whole
R=[re.compile(x,re.I) for x in (r"(AKIA|ASIA)[0-9A-Z]{16}",r"gh[pousr]_[A-Za-z0-9]{20,}",r"github_pat_[A-Za-z0-9_]{30,}",r"sk-[A-Za-z0-9_-]{20,}",r"xox[abprs]-[A-Za-z0-9-]{10,}",r"(glpat-|npm_|hf_|AIza|ya29\.)[A-Za-z0-9_-]{16,}",r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}",r"(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{16,}",r"://[^\s:@/]{1,64}:[^\s@/]{3,}@",r"(password|passwd|passphrase|pwd|secret|api[_-]?key|access[_-]?key|[_-]token)[\"\x27]?\s*[=:]\s*[\"\x27]?[^\s\"\x27&;,]{6,}",r"(--(password|token|api-key|secret)[= ]|\s-p)[^\s\"\x27|;&]{3,}",r"-----BEGIN [A-Z ]*PRIVATE KEY-----")]
def clean(v,n=0):
  if isinstance(v,str):
    for r in R: v=r.sub("[redacted]",v)
    return v[:2000]
  if isinstance(v,dict) and n<6: return {k:clean(x,n+1) for k,x in list(v.items())[:60]}
  if isinstance(v,list) and n<6: return [clean(x,n+1) for x in v[:60]]
  return v
if "tool_input" in d: d["tool_input"]=clean(d["tool_input"])
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
