import { bashCategory, psCategory, mcpCategory } from '../src/intent.js';
const cases = [
  ['cat /etc/nginx/nginx.conf', 'read'], ['ls -la /var/log', 'read'], ['grep -rn "error" /var/log/syslog | tail -50', 'read'],
  ['journalctl -u nginx --since "1 hour ago" | grep -i fail', 'read'], ['sudo systemctl status nginx', 'read'], ['systemctl restart nginx', 'ops'],
  ['sudo -u postgres psql -c "select 1"', 'exec'], ['cd /srv/app && npm test', 'exec'], ['npm install', 'ops'], ['npm run build 2>&1 | tail -20', 'exec'],
  ['apt-get update && apt-get install -y nginx', 'ops'], ['apt list --installed', 'read'], ['docker ps -a', 'read'], ['docker compose up -d', 'ops'],
  ['docker compose logs -f web', 'read'], ['docker exec -it web sh', 'exec'], ['kubectl get pods -n prod', 'read'], ['kubectl apply -f deploy.yaml', 'ops'],
  ['git status', 'read'], ['git diff HEAD~1', 'read'], ['git add -A && git commit -m "fix"', 'write'], ['git push origin main', 'web'], ['git pull', 'web'],
  ['curl -s https://api.example.com/health | jq .', 'web'], ['ssh root@host "uptime"', 'web'], ['sed -i "s/a/b/" app.conf', 'write'], ['sed -n 1,20p file', 'read'],
  ['echo "hello" > /tmp/x.txt', 'write'], ['echo hi', 'exec'], ['cat a.log > /dev/null', 'read'], ['mkdir -p /srv/app && cp -r dist /srv/app', 'write'],
  ['python3 manage.py migrate', 'exec'], ['pytest -q tests/', 'exec'], ['./deploy.sh', 'exec'], ['tar -tzf backup.tgz', 'read'], ['tar -czf backup.tgz /etc', 'write'],
  ['find . -name "*.log" -mtime +7 -delete', 'read'], ['pm2 restart all', 'ops'], ['kill -9 1234', 'ops'], ['df -h && free -m', 'read'],
  ['ps aux | grep node', 'read'], ['crontab -l', 'read'], ['ufw allow 443', 'ops'], ['certbot renew --dry-run', 'ops'], ['timeout 5 curl localhost:8080', 'web'],
  ['FOO=1 node script.js', 'exec'], ['cat <<EOF > /etc/motd\nhello > world\nEOF', 'write'], ['npm test | tee test.log', 'exec'], ['cat a | tee b', 'write'],
  ['prettier --write src', 'write'], ['eslint src', 'exec'], ['pip install requests', 'ops'], ['uv run pytest', 'exec'], ['rsync -av dist/ root@srv:/var/www/', 'web'],
  ['terraform plan', 'read'], ['terraform apply -auto-approve', 'ops'], ['vim /etc/hosts', 'write'], ['', 'exec'],
];
let bad = 0;
for (const [c, want] of cases) { const got = bashCategory(c); if (got !== want) { bad++; console.log('MISMATCH', JSON.stringify(c), 'got', got, 'want', want); } }
const ps = [['Get-ChildItem C:\\x', 'read'], ['Set-Content -Path a.txt -Value 1', 'write'], ['Invoke-WebRequest https://x', 'web'], ['Restart-Service nginx', 'ops'], ['npm test', 'exec']];
for (const [c, want] of ps) { const got = psCategory(c); if (got !== want) { bad++; console.log('PS MISMATCH', c, got, want); } }
const mcp = [['mcp__memory__memory_read', 'read'], ['mcp__github__create_issue', 'write'], ['mcp__claude-in-chrome__navigate', 'web'], ['mcp__playwright__browser_click', 'web'],
  ['mcp__slack__send_message', 'write'], ['mcp__linear__list_issues', 'read'], ['mcp__brave-search__brave_web_search', 'web'], ['mcp__foo__do_thing', 'mcp']];
for (const [c, want] of mcp) { const got = mcpCategory(c); if (got !== want) { bad++; console.log('MCP MISMATCH', c, got, want); } }
console.log(bad ? `${bad} mismatches` : `all ${cases.length + ps.length + mcp.length} cases ok`);
for (const [c, want] of [['git -C /srv/app pull', 'web'], ['npm --prefix /srv/app ci', 'ops'], ['npm --prefix /srv/app run build', 'exec'], ['kubectl -n prod get pods', 'read'], ['docker compose -f prod.yml up -d', 'ops'], ['pnpm --filter web test', 'exec']]) {
  const got = bashCategory(c); if (got !== want) bad++; console.log(got === want ? 'ok ' : 'MISMATCH', c, got);
}
// bashParts: one entry per command of a chain or pipeline
import { bashParts } from '../src/intent.js';
const parts = bashParts('git pull && npm ci && npm test | tee out.log').map(p => p.cat + ':' + p.cmd).join(' ');
if (parts !== 'web:git ops:npm exec:npm write:tee') { bad++; console.log('MISMATCH bashParts', parts); }
// shellTargets: where a command reaches
import { shellTargets } from '../src/intent.js';
const st = (c) => shellTargets(c).map(([k, v]) => k + '=' + v).join(' ');
for (const [c, want] of [
  ['ssh -p 2222 deploy@build.example.com "tail /var/log/ci.log"', 'host=deploy@build.example.com'],
  ['ssh -i ~/.ssh/key srv uptime', 'host=srv'],
  ['scp dist.tgz root@10.0.0.5:/srv/ && rsync -av ./ backup:/data/', 'host=root@10.0.0.5 host=backup'],
  ['curl -s https://ci.example.com/api/status > status.json', 'url=https://ci.example.com/api/status writes=status.json'],
  ['cd /srv/app && npm run build 2>&1 | tee build.log', 'writes=build.log cd=/srv/app'],
  ['git push origin main', 'git=push origin main'],
  ['sudo systemctl restart nginx', 'as=root (sudo)'],
  ['echo "a > b" && cat x > /dev/null 2>&1', ''],
  ['scp C:/x.txt host:/tmp/', 'host=host'],
]) { const got = st(c); if (got !== want) { bad++; console.log('MISMATCH shellTargets', JSON.stringify(c), '->', got, 'want', want); } }
if (bad) { console.log('FAIL', bad, 'mismatches'); process.exitCode = 1; }
