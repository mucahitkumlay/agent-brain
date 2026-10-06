'use strict';
/*
 * Agent Brain — shows Claude Code sessions as live neural activity on a real MRI brain surface
 * (MNI ICBM152 2009). WebGL (three.js) + bloom. Never calls a model and uses no tokens:
 * it only listens for hook events on 127.0.0.1.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { INSTALL_SH } from './scripts.js';
import { REPO, ASSETS } from './generated.js';
import { bashCategory, bashParts, psCategory, mcpCategory, shellTargets } from './intent.js';
import { AAL, AAL_LOBE, GYRI, aalName, bundleName, parseAal, parseInner, parseT1, parseTracts, makeInner, makeTracts, makeSlice } from './anatomy.js';

const { Plugin, ItemView, Notice, PluginSettingTab, Setting, setIcon, requestUrl } = require('obsidian');
const http = require('http');

const VIEW_TYPE = 'agent-brain-view';
const VIEW_MINI = 'agent-brain-mini';
const DEFAULTS = {
  port: 27182, ambient: false, autoRotate: true, regionLabels: false, bloom: true, glass: 0.62,
  follow: true, memoryTrace: true, notifyApproval: true, notifyReply: true, desktopNotify: true,
  quality: 'auto', fps: 60, glow: 0.45,
  dailyNote: true, dailyFolder: 'Claude Activity', learning: true, minimal: false,
  showSessions: true, sessionsOpen: true, showActivity: false, showTimeline: false, showRegions: false,
  showInner: true, showTracts: true, showNotes: true, sliceOn: false, sliceAxis: 'x', slicePos: 0.5, sliceCut: true,
  traceMinutes: 90, vitals: true, showVitals: true,
  telemetry: true, notifyStuck: true, dream: true, showEeg: true, callDetails: true, look: 'anatomy',
};
// "who": one color per session. Chosen to stay apart from the lobe colors ("what").
const SESSION_COLORS = ['#7fe0c2', '#c3a6ff', '#7cc4ff', '#f59ac0', '#b6e388', '#dfe6f2'];
const WAIT = '#ffb547';
const TRACE_HALF_LIFE = 2 * 3600 * 1000;   // memory trace fades by half every 2 hours
const STALE = 15 * 60 * 1000;              // a session silent this long is no longer "thinking"
const LEARN_HALF_LIFE = 3 * 24 * 3600 * 1000; // learned connections fade by half every 3 days unless used
const HISTORY_MS = 6 * 3600 * 1000;          // timeline keeps the last 6 hours

/* ================================================================ regions */

const LOBES = {
  frontal:    { label: 'FRONTAL',    fn: 'running · planning',      color: '#ff5c6c' },
  motor:      { label: 'MOTOR',      fn: 'writing · editing',       color: '#3ccf91' },
  parietal:   { label: 'PARIETAL',   fn: 'subagents · other tools', color: '#f4b740' },
  temporal:   { label: 'TEMPORAL',   fn: 'reading · searching',     color: '#a77bff' },
  occipital:  { label: 'OCCIPITAL',  fn: 'web · network',           color: '#4fa8ff' },
  cerebellum: { label: 'CEREBELLUM', fn: 'services · integrations', color: '#3fd6d6' },
  thalamus:   { label: 'THALAMUS',   fn: 'relay · hub notes', color: '#e8edf3' },
  stem:       { label: 'BRAIN STEM', fn: 'session signals',    color: '#c9d1dc' },
};
const LOBE_ORDER = ['frontal', 'motor', 'parietal', 'temporal', 'occipital', 'cerebellum', 'thalamus', 'stem'];

const CAT = {
  read:  { lobe: 'temporal',   tag: 'READ'  },
  write: { lobe: 'motor',      tag: 'WRITE' },
  exec:  { lobe: 'frontal',    tag: 'RUN'   },
  ops:   { lobe: 'cerebellum', tag: 'OPS'   },
  plan:  { lobe: 'frontal',    tag: 'PLAN'  },
  web:   { lobe: 'occipital',  tag: 'WEB'   },
  agent: { lobe: 'parietal',   tag: 'AGENT' },
  mcp:   { lobe: 'cerebellum', tag: 'MCP'   },
  other: { lobe: 'parietal',   tag: 'TOOL'  },
};
const catColor = (cat) => LOBES[(CAT[cat] || CAT.other).lobe].color;
const SIGNAL = '#dfe9ff';
const VITAL = '#8fb3c9';      // body signals (CPU, memory, network): a quiet blue-grey, apart from Claude's colours
const ERR = '#ff6b6b';
const GOLD = '#ffd27a';       // reward: a task completed

// which real white-matter bundles (HCP-1065) carry each kind of signal
const ROUTES = {
  read:   ['AF', 'ILF', 'IFOF', 'MdLF', 'EMC', 'UF'],       // language and semantic streams into the temporal lobe
  write:  ['CST', 'TR_S', 'FAT', 'CS_S', 'CBT'],            // motor output
  exec:   ['TR_A', 'CS_A', 'FAT', 'SLF2'],                  // prefrontal – striatal – thalamic loop
  plan:   ['C_FP', 'SLF1', 'TR_A', 'FAT'],                  // frontoparietal control network
  web:    ['OR', 'IFOF', 'VOF', 'ILF'],                     // visual pathway
  agent:  ['SLF2', 'SLF3', 'PAT', 'TR_P', 'C_PHP'],         // parietal: delegated work
  ops:    ['MCP', 'SCP', 'CPT_F', 'DRTT', 'ICP'],           // cerebellar loops: system work
  mcp:    ['DRTT', 'SCP', 'CPT_P', 'MCP'],
  other:  ['SLF3', 'TR_P', 'C_FP'],
  prompt: ['AR', 'AF'],                                     // your prompt: acoustic radiation, then Wernicke's area
  speak:  ['AF', 'FAT'],                                    // Claude's reply: arcuate fasciculus into Broca's area
  think:  ['TR_A', 'CS_A', 'FAT', 'SLF1', 'C_FP', 'SLF2'],  // deliberation: prefrontal loops
  memory: ['F', 'C_PH', 'C_FPH', 'C_PHP'],                  // hippocampus: recall and consolidation
  self:   ['C_FP', 'C_PHP', 'SLF1'],
  alarm:  ['UF', 'C_FP'],                                   // amygdala – orbitofrontal – cingulate
  reward: ['UF', 'CS_A'],
  place:  ['C_PHP', 'C_PH', 'ILF'],
  sense:  ['TR_S', 'ML'],
  social: ['AF', 'MdLF', 'SLF3'],
  arouse: ['RST', 'ML'],                                    // brain stem: waking up
  body:   ['ML', 'RST', 'MCP', 'ICP', 'CST'],               // body signals from the machine
};
const NUCLEUS = { read: 'Hippocampus', write: 'Putamen', exec: 'Caudate nucleus', plan: 'Caudate nucleus', ops: 'Globus pallidus', mcp: 'Globus pallidus', web: 'Thalamus', agent: 'Thalamus', other: 'Thalamus' };

const LOBE_RULES = [
  [/(^|\/)(hubs?|index|moc|home)(\/|$)/i, 'thalamus'],
  [/(^|\/)(daily|journal|logs?|incidents?|handoffs?)(\/|$)/i, 'cerebellum'],
  [/(^|\/)(lessons?|memory|memories|owner|people|persons?|learn\w*|notes?)(\/|$)/i, 'temporal'],
  [/(^|\/)(docs?|references?|sources?|repos?|archive|readme)(\/|$)/i, 'occipital'],
  [/(^|\/)(projects?|decisions?|plans?|tasks?|todo|roadmap)(\/|$)/i, 'frontal'],
  [/(^|\/)(drafts?|writing|edits?|templates?)(\/|$)/i, 'motor'],
  [/(^|\/)(tools?|plugins?|kernel|install|security|tests?|concepts?|agents?)(\/|$)/i, 'parietal'],
];

// three.js coordinates (mm): x right, y up, z posterior (+) / anterior (-)
const THALAMUS = { x: 11, y: -3, z: 3 };
const STEM = { x: 0, y: -40, z: 13 };

/* ================================================================ helpers */

function strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
// what a tool call does decides where it lights up; shell commands are judged by their text (see intent.js)
function toolCategory(name, input) {
  if (!name) return 'other';
  if (/^(Read|Glob|Grep|LS|NotebookRead|Skill|BashOutput|TaskOutput|ListMcpResourcesTool|ReadMcpResourceTool)$/.test(name)) return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return 'write';
  if (name === 'Bash') return bashCategory(input && input.command);
  if (name === 'PowerShell') return psCategory(input && input.command);
  if (/^(KillShell|KillBash|TaskStop)$/.test(name)) return 'ops';
  if (/^(WebFetch|WebSearch)$/.test(name)) return 'web';
  if (/^(Task|Agent|Workflow|SendMessage)$/.test(name)) return 'agent';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|ExitPlanMode|EnterPlanMode|AskUserQuestion)$/.test(name)) return 'plan';
  if (name.startsWith('mcp__')) return mcpCategory(name);
  return 'other';
}
const evCat = (ev) => (ev && ev._cat) || toolCategory(ev && ev.tool_name, ev && ev.tool_input);
function baseName(p) {
  if (!p || typeof p !== 'string') return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
function normPath(p) {
  if (!p || typeof p !== 'string') return '';
  let s = p.replace(/\\/g, '/');
  let m = s.match(/^\/mnt\/([a-zA-Z])\/(.*)$/); if (m) s = m[1] + ':/' + m[2];
  m = s.match(/^\/([a-zA-Z])\/(.*)$/); if (m) s = m[1] + ':/' + m[2];
  return s.replace(/\/+$/, '');
}
function toolLabel(name) { return !name ? '' : name.startsWith('mcp__') ? name.split('__').slice(1).join(' ') : name; }
function cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
function targetOf(ev, plugin) {
  const ti = (ev && ev.tool_input) || {};
  const fp = ti.file_path || ti.notebook_path;
  if (fp) { const rel = plugin && plugin.toVaultRel(fp, ev.cwd); return rel || baseName(fp); }
  if (ti.pattern) return '"' + String(ti.pattern).slice(0, 32) + '"';
  if (ti.path) { const rel = plugin && plugin.toVaultRel(ti.path, ev.cwd); return (rel === '' ? '/' : rel) || baseName(ti.path); }
  if (ti.description) return String(ti.description).slice(0, 48);
  if (ti.command) return clip(String(ti.command).split('\n')[0].trim(), 44);
  if (ti.subagent_type) return String(ti.subagent_type);
  if (ti.url) { try { return new URL(ti.url).hostname; } catch (e) { return ''; } }
  if (ti.query) return '"' + String(ti.query).slice(0, 32) + '"';
  return '';
}
function workflowName(ti) {
  ti = ti || {};
  const v = ti.name || ti.workflow || ti.workflow_name || ti.command || ti.script_path || ti.scriptPath || ti.path || ti.file || ti.description || '';
  return clip(String(v).replace(/^\//, '').split(/[\\/]/).pop().replace(/\.(m?js|ts)$/, ''), 40) || 'workflow';
}
function describe(ev) {
  const ti = (ev && ev.tool_input) || {};
  if (ev && ev.tool_name === 'Workflow') return 'Workflow ' + workflowName(ti);
  if (ev && ev.tool_name === 'TaskCreate') return 'New task: ' + clip(ti.subject || '', 40);
  if (ev && ev.tool_name === 'TaskUpdate') return 'Task ' + (ti.taskId != null ? ti.taskId : '?') + (ti.status ? ' ' + String(ti.status).replace('_', ' ') : ' updated');
  if (ev && ev.tool_name === 'TodoWrite') { const td = Array.isArray(ti.todos) ? ti.todos : []; return `Plan updated, ${td.filter(t => t.status === 'completed').length} of ${td.length} done`; }
  const t = ti.file_path ? baseName(ti.file_path) : targetOf(ev, null);
  const tool = toolLabel(ev.tool_name);
  if (!t) return tool;
  if (ev.tool_name === 'Bash' || ev.tool_name === 'PowerShell') return t;   // the command or its description says it all
  return tool + (/\s/.test(t) && !/^["']/.test(t) ? ': ' : ' ') + t;   // "Read config.ts", "Bash: Run the tests"
}
// short, plain description of any hook event for the activity list and timeline (never prompt or reply text)
function eventText(ev) {
  const e = ev.hook_event_name;
  switch (e) {
    case 'PreToolUse': case 'PermissionRequest': case 'PermissionDenied': return describe(ev);
    case 'Notification': return clip(ev.message || '', 80);
    case 'InstructionsLoaded': return `${baseName(ev.file_path)}${ev.load_reason ? ' (' + String(ev.load_reason).replace(/_/g, ' ') + ')' : ''}`;
    case 'CwdChanged': return baseName(ev.new_cwd || ev.cwd) || '/';
    case 'DirectoryAdded': return baseName(ev.directory_path || ev.directory || '');
    case 'FileChanged': return `${baseName(ev.file_path)}${ev.change_type ? ' ' + ev.change_type : ''}`;
    case 'TaskCreated': case 'TaskCompleted': return clip(ev.task_name || '', 60);
    case 'StopFailure': return String(ev.error_type || 'error').replace(/_/g, ' ');
    case 'PostCompact': return ev.tokens_before ? `${Math.round(ev.tokens_before / 1000)}k → ${Math.round((ev.tokens_after || 0) / 1000)}k tokens` : '';
    case 'UserPromptExpansion': return ev.command_name ? '/' + ev.command_name : '';
    case 'PreModelSwitch': case 'PostModelSwitch': return String(ev.to_model || ev.model || '');
    case 'ConfigChange': return String(ev.source || ev.config_key || 'settings');
    case 'Elicitation': case 'ElicitationResult': return clip(ev.mcp_server_name || ev.server_name || ev.message || '', 60);
    case 'PostToolBatch': return Array.isArray(ev.tool_calls) ? `${ev.tool_calls.length} results together` : '';
    default: return '';
  }
}
function strikeWhat(r) {
  const k = String(r.key || '');
  if ((r.tool === 'Grep' || r.tool === 'Glob') && r.text) return r.text;     // 'Grep "retryPolicy"', not the folder
  if (r.file) return baseName(r.file);
  if (r.tool === 'Bash' && k) { const p = bashParts(k, 1)[0]; return p ? p.cmd : 'shell'; }
  if (r.tool === 'PowerShell' && k) return k.trim().split(/\s+/)[0].slice(0, 30);
  if (/^https?:\/\//.test(k)) { try { return new URL(k).hostname; } catch (e) { return 'web'; } }
  if (r.tool === 'WebSearch' || r.tool === 'Grep' || r.tool === 'Glob') return toolLabel(r.tool) + (k ? ' "' + k.slice(0, 24) + '"' : '');
  if (r.tool === 'Agent' || r.tool === 'Task') return 'agent ' + (k || '').slice(0, 24);
  return toolLabel(r.tool) || (r.text || '');
}
function responseSize(r) {
  if (r == null) return 0;
  if (typeof r === 'string') return r.length;
  if (typeof r === 'object') { let n = 0; for (const k of ['stdout', 'stderr', 'content', 'output', 'result', 'text']) if (typeof r[k] === 'string') n += r[k].length; else if (Array.isArray(r[k])) n += r[k].length * 200; return n; }
  return 0;
}
// requests a browser page could make carry an Origin (a web origin) or Sec-Fetch-Site header; Claude Code's hooks,
// its telemetry exporter, curl and the tunnel send neither, and always address 127.0.0.1 / localhost
function fromThisMachine(h) {
  h = h || {};
  const host = String(h.host || '').toLowerCase();
  if (host && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false;
  if (h['sec-fetch-site'] || h['sec-fetch-dest'] === 'document' || h['sec-fetch-dest'] === 'iframe') return false;
  const o = h.origin;
  if (o && o !== 'null') return false;
  return true;
}
// ---------- full call details for the inspector: kept in memory only, never written to disk ----------
const DETAIL_STR = 20000;      // longest string kept from one field
const DETAIL_CALL = 160000;    // characters kept from one hook event
const DETAIL_BUDGET = 24e6;    // characters kept for all events together; the oldest go first
function capDeep(v, lim, depth) {
  depth = depth || 0;
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const max = Math.max(160, Math.min(DETAIL_STR, lim.left));
    const s = v.length > max ? v.slice(0, max) : v;
    lim.left -= s.length;
    return s.length < v.length ? s + `\n… [${(v.length - s.length).toLocaleString('en-US')} more characters not kept]` : s;
  }
  if (depth > 8) return '[…]';
  if (Array.isArray(v)) {
    const out = v.slice(0, 200).map(x => capDeep(x, lim, depth + 1));
    if (v.length > 200) out.push(`[… ${v.length - 200} more items not kept]`);
    return out;
  }
  if (typeof v === 'object') {
    const o = {}; let i = 0;
    for (const k of Object.keys(v)) { if (++i > 200) { o['…'] = 'more fields not kept'; break; } o[k] = capDeep(v[k], lim, depth + 1); lim.left -= k.length; }
    return o;
  }
  return String(v);
}
// why each kind of work lands where it does
const KIND_WHY = {
  read: 'Reading and searching is retrieval: the language and memory streams of the temporal lobe, with the hippocampus.',
  write: 'Writing a file is an action: primary and supplementary motor cortex, through the putamen.',
  exec: 'Running a command is executive control: dorsolateral prefrontal cortex in its loop with the caudate and the thalamus.',
  plan: 'Planning is holding a goal: the frontoparietal control network and the caudate.',
  web: 'The web is the outside world coming in: the visual pathway into occipital cortex, relayed by the thalamus.',
  agent: 'Handing work to another agent is delegation: parietal association cortex, relayed by the thalamus.',
  ops: 'System work (services, packages, processes) is a practised routine: cerebellar loops and the globus pallidus.',
  mcp: 'An MCP tool is an external instrument: cerebellar loops through the globus pallidus.',
  other: 'A tool without a closer analogue: parietal association cortex.',
  prompt: 'Your prompt is heard: auditory cortex and Wernicke\'s area, relayed by the thalamus.',
  speak: 'Claude writing its reply is speech: Broca\'s area, fed by the arcuate fasciculus.',
  think: 'Deliberation: prefrontal loops through the caudate.',
  memory: 'Compacting context is consolidation: the hippocampus and parahippocampal gyrus.',
  self: 'Instructions and settings are the model of itself: precuneus and posterior cingulate.',
  alarm: 'Conflict (an error, a denial, a permission prompt): anterior cingulate and orbitofrontal cortex, with the amygdala.',
  reward: 'A finished task is reward: medial orbitofrontal cortex and the caudate.',
  place: 'Moving to another folder is navigation: the parahippocampal place area and precuneus.',
  sense: 'A file changing on disk is a sensation: somatosensory cortex, via the thalamus.',
  social: 'Asking you something is social: the angular gyrus and temporal pole, with the amygdala.',
};
const HOOK_TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied'];
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'UserPromptExpansion', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Notification',
  'Stop', 'StopFailure', 'SessionEnd', 'PostToolBatch', 'TaskCreated', 'TaskCompleted', 'InstructionsLoaded', 'CwdChanged', 'DirectoryAdded', 'ConfigChange',
  'Elicitation', 'ElicitationResult', 'PreModelSwitch', 'PostModelSwitch', 'TeammateIdle'];
// Claude Code telemetry to the brain: only the log events (one per model call, tool result, error), as OTLP/HTTP JSON
// on this machine. Prompt and reply text stay redacted (Claude Code's default). Left alone if telemetry already goes elsewhere.
const TELEMETRY_ENV = (port) => ({
  CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `http://127.0.0.1:${port}/v1/logs`, OTEL_LOGS_EXPORT_INTERVAL: '1000',
});
function mergeTelemetryEnv(cfg, port) {
  const env = cfg.env && typeof cfg.env === 'object' ? cfg.env : (cfg.env = {});
  const mine = (v) => /127\.0\.0\.1:\d+\/v1\/logs/.test(String(v || ''));
  const elsewhere = (env.OTEL_EXPORTER_OTLP_ENDPOINT && !mine(env.OTEL_EXPORTER_OTLP_ENDPOINT)) || (env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT && !mine(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT)) ||
    (env.OTEL_LOGS_EXPORTER && env.OTEL_LOGS_EXPORTER !== 'otlp');
  if (elsewhere) return 'other';
  Object.assign(env, TELEMETRY_ENV(port));
  if (!env.OTEL_METRICS_EXPORTER) env.OTEL_METRICS_EXPORTER = 'none';
  return 'set';
}
// events that don't mean the session stopped waiting for you
const PASSIVE = new Set(['Notification', 'Stop', 'StopFailure', 'PermissionRequest', 'Elicitation', 'FileChanged', 'ConfigChange', 'InstructionsLoaded', 'TeammateIdle', 'SessionEnd', 'PostToolBatch']);
function shuffled(arr, k) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return k === undefined ? a : a.slice(0, k);
}
const col3 = (hex) => new THREE.Color(hex);
const engCell = (x, y, z) => ((x + 64) * 128 + (y + 64)) * 128 + (z + 64);
const ENG_SIGMA = 8;
const BOLD = '#ff8a4c';       // metabolic (haemodynamic) response, in the warm colours fMRI uses
const DREAM = '#7d8fc4';
const EEG_CH = ['frontal', 'motor', 'parietal', 'temporal', 'occipital'];
const EEG_LABEL = ['Fp', 'C', 'P', 'T', 'O'];
const EEG_N = 240;
// shown slowed down so the waves stay readable: the names are the real bands, the speeds only keep their order
const EEG_RHYTHM = { delta: { f: 0.8, a: 0.75, name: 'delta · sleep replay' }, alpha: { f: 2.2, a: 0.28, name: 'alpha · idle' }, beta: { f: 4.2, a: 0.22, name: 'beta · running tools' }, gamma: { f: 7.5, a: 0.2, name: 'gamma · thinking' } };
const KIND_TAG = { read: 'read', write: 'write', exec: 'run', ops: 'ops', web: 'web', agent: 'agent', plan: 'plan', mcp: 'mcp', other: 'tool', prompt: 'heard', speak: 'wrote', think: 'thought', memory: 'memory', self: 'instructions', alarm: 'alarm', reward: 'done', place: 'moved', sense: 'sensed', social: 'asked' };
const KIND_HEX = { prompt: '#8fb4ff', speak: '#7fc8ff', think: '#c8c2ff', memory: '#c9b8ff', self: '#b8c4d6', alarm: ERR, reward: GOLD, place: '#8fe0c8', sense: '#c9d1dc', social: WAIT };
const KIND_NUCLEUS = { prompt: 'Thalamus', think: 'Caudate nucleus', memory: 'Hippocampus', self: 'Hippocampus', alarm: 'Amygdala', reward: 'Caudate nucleus', place: 'Hippocampus', sense: 'Thalamus', social: 'Amygdala' };
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return '0:' + String(s).padStart(2, '0');
  if (s < 3600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  return Math.floor(s / 3600) + 'h' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
}
function isoDay(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function hhmm(t, sec) { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + (sec ? ':' + String(d.getSeconds()).padStart(2, '0') : ''); }
function fmtSpan(ms) { const m = Math.round(ms / 60000); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; }
// the context window a session works with: 1M for the long-context models, otherwise 200k
function ctxLimit(M) { return M.ctx > 200000 || /\[1m\]|1m/i.test(M.model || '') ? 1000000 : 200000; }
function fmtTok(n) { n = Math.max(0, n || 0); return n < 1000 ? String(Math.round(n)) : n < 1e6 ? (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k' : (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M'; }
function fmtRate(b) { b = Math.max(0, b || 0); return b < 1024 ? Math.round(b) + ' B/s' : b < 1048576 ? (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' kB/s' : (b / 1048576).toFixed(1) + ' MB/s'; }
function fmtAgo(ms) { ms = Math.max(0, ms); return ms < 60000 ? Math.round(ms / 1000) + 's' : ms < 3600000 ? Math.round(ms / 60000) + 'm' : Math.round(ms / 3600000) + 'h'; }
function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function angDiff(a, b) { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

/* ================================================================ shaders */

const MAXP = 24, MAXW = 4;
const BRAIN_VS = `
attribute float aDepth;
attribute float aLobe;
uniform vec4 uPulse[${MAXP}];
uniform vec4 uPulseC[${MAXP}];
uniform vec4 uWave[${MAXW}];
uniform vec4 uWaveC[${MAXW}];
uniform int uNP; uniform int uNW;
uniform float uDim[8];
attribute vec3 aEng; uniform float uEngK; uniform float uEngOn;
varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec3 vAct; varying float vDim; varying vec3 vTrace; varying vec3 vW;
#include <clipping_planes_pars_vertex>
void main() {
  vW = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 mv = mvPosition;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vDepth = aDepth;
  vec3 act = vec3(0.0);
  for (int i = 0; i < ${MAXP}; i++) {
    if (i >= uNP) break;
    vec3 d = position - uPulse[i].xyz;
    float s = uPulse[i].w;
    act += uPulseC[i].rgb * uPulseC[i].a * exp(-dot(d, d) / (s * s));
  }
  for (int i = 0; i < ${MAXW}; i++) {
    if (i >= uNW) break;
    float d = distance(position, uWave[i].xyz) - uWave[i].w;
    act += uWaveC[i].rgb * uWaveC[i].a * exp(-(d * d) / 9.0);
  }
  vAct = act;
  int li = int(aLobe + 0.5);
  vDim = uDim[li];
  vTrace = aEng * (uEngK * uEngOn);          // engram: what this patch of cortex has done lately
  gl_Position = projectionMatrix * mv;
  #include <clipping_planes_vertex>
}`;
const BRAIN_FS = `
uniform vec3 uLight; uniform vec3 uBase; uniform vec3 uRim; uniform float uGlass; uniform vec4 uCut; uniform float uCutOn; uniform float uLook;
varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec3 vAct; varying float vDim; varying vec3 vTrace; varying vec3 vW;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec3 N = normalize(vN); vec3 V = normalize(vV);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 2.4);
  float gyr = smoothstep(0.12, 0.88, vDepth);           // 0 = sulcal fundus, 1 = gyral crown
  float diff = max(dot(N, normalize(uLight)), 0.0);
  float spec = pow(max(dot(N, normalize(normalize(uLight) + V)), 0.0), 28.0) * 0.2 * gyr;
  vec3 col = uBase * (0.08 + 0.92 * diff) * mix(0.14, 1.0, gyr) + spec;
  col += uRim * fres * mix(0.25, 1.0, gyr);
  // every action leaves a mark where it happened: colour = what kind of work, brightness = how much, fading over hours
  float tI = max(vTrace.r, max(vTrace.g, vTrace.b));
  vec3 tr = vTrace / max(tI, 1e-4) * (1.0 - exp(-tI * 0.38));
  col += tr * mix(0.05, 0.3, gyr) * (0.55 + 0.45 * ndv);
  vec3 A = vec3(1.0) - exp(-vAct * 0.85);               // soft saturation: keeps hue instead of blowing out to white
  float a = max(A.r, max(A.g, A.b));
  col += A * mix(0.25, 0.8, gyr);
  col *= vDim;
  float alpha = clamp(mix(1.0, uGlass, ndv) + fres * 0.4 + a * 0.3, 0.0, 1.0) * mix(0.18, 1.0, vDim);
  // atlas look: the cortex becomes a faint glass shell with a clear outline, so the neurons, synapses and signals
  // inside carry the picture; activity and the trace still colour it
  if (uLook > 0.001) {
    vec3 rimA = vec3(0.30, 0.37, 0.52);
    vec3 colA = uBase * 0.04 * (0.5 + 0.5 * diff) * gyr + rimA * (0.035 + 0.6 * fres * gyr) + tr * 0.45 + A * 0.75;
    float alphaA = clamp(0.012 + fres * gyr * 0.22 + a * 0.4 + min(tI * 0.04, 0.12), 0.0, 1.0) * mix(0.25, 1.0, vDim);
    col = mix(col, colA * mix(0.3, 1.0, vDim), uLook); alpha = mix(alpha, alphaA, uLook);
  }
  // in front of an MRI slice the cortex turns into a faint glass outline, so the slice shows but the brain stays whole
  float ghost = uCutOn * (1.0 - smoothstep(-2.5, 0.5, dot(uCut.xyz, vW) + uCut.w));
  col = mix(col, uRim * (0.2 + 0.9 * fres) + A * 0.25, ghost);
  alpha = mix(alpha, 0.03 + fres * 0.22 + a * 0.15, ghost);
  gl_FragColor = vec4(col, alpha);
}`;
const POINT_VS = `
attribute float aSize; attribute vec3 aColor; attribute float aGlow;
uniform float uScale;
varying vec3 vC; varying float vG;
#include <clipping_planes_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mvPosition.z * (1.0 + aGlow * 1.8);
  vC = aColor; vG = aGlow;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const POINT_FS = `
uniform float uRing;
varying vec3 vC; varying float vG;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0) discard;
  // atlas look (uRing): a crisp core with a thin ring around it, so each neuron reads as a point, not a smudge
  float core = exp(-d * d * mix(7.0, 18.0, uRing));
  float halo = exp(-d * d * 2.2) * mix(0.25, 0.1, uRing);
  float ring = uRing * (1.0 - smoothstep(0.0, 0.09, abs(d - 0.6))) * 0.32;
  float v = core + halo + ring;
  gl_FragColor = vec4(vC * v * (0.42 + 1.25 * vG), v);
}`;
// two ways to look at it: the realistic MRI glass, or a clear atlas where the brain is a faint shell and the neurons
// (notes and files), synapses (links) and signals inside carry the picture
const LOOKS = {
  anatomy: { inner: 1, tract: 0.045, link: 0.04, learn: 0.22, node: 1, nodeSize: 1, tint: 0, spike: 1, bloom: 1, ring: 0, bg: 0x030407 },
  atlas: { inner: 0.26, tract: 0.018, link: 0.065, learn: 0.4, node: 1.8, nodeSize: 1.3, tint: 0.45, spike: 1.25, bloom: 0.45, ring: 1, bg: 0x0a0b10 },
};

/* ================================================================ view */

class BrainView extends ItemView {
  constructor(leaf, plugin, mini) {
    super(leaf);
    this.plugin = plugin;
    this.mini = !!mini;
    this.focusSid = null;              // session the user clicked: others fade
    this.panel = null;                 // { kind: 'session'|'region', id }
    this.replay = null;                // { clock, speed, idx, until }
    this.tlRange = 60 * 60000;         // timeline window
    this.tlSpeed = 20;
    this.labelBlocks = [];
    this.nodes = []; this.links = []; this.byPath = new Map();
    this.spikes = []; this.pulses = []; this.waves = []; this.pings = [];
    this.view = { yaw: -1.15, pitch: 0.22, dist: 430, panX: 0, panY: 0 };
    this.hover = null; this.log = []; this.dim = new Set();
    this.lastActivity = 0; this.lastInteract = -1e9; this.ambientT = 0; this.lastDraw = 0; this.frameN = 0;
    this.poolCache = new Map(); this.graphSig = '';
    this.tags = [];                    // recent tool events shown under region labels
    this.attn = {};                    // decaying activity score per lobe (camera follow)
    this.focus = null; this.focusAt = -1e9;
    this.traceP = Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, 1));
    this.traceC = Array.from({ length: 12 }, () => new THREE.Vector3());
    this.eeg = { buf: EEG_CH.map(() => new Float32Array(EEG_N)), pos: 0, acc: 0, t: 0, env: new Float32Array(EEG_CH.length), kick: new Float32Array(EEG_CH.length), state: 'alpha' };
  }
  getViewType() { return this.mini ? VIEW_MINI : VIEW_TYPE; }
  getDisplayText() { return this.mini ? 'Agent Brain (mini)' : 'Agent Brain'; }
  getIcon() { return 'brain-circuit'; }
  // canvases draw labels in the same interface font as the theme
  fontUI() {
    if (!this._fontUI && this.contentEl) this._fontUI = getComputedStyle(this.contentEl).fontFamily || 'system-ui, sans-serif';
    return this._fontUI || 'system-ui, sans-serif';
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('cb-root');
    root.toggleClass('cb-mini', this.mini);
    root.toggleClass('cb-min', !this.mini && !!this.plugin.settings.minimal);
    root.setAttr('tabindex', '0');
    if (this.mini) this.view.dist = 300;
    this.glHost = root.createDiv({ cls: 'cb-gl' });
    this.overlay = root.createEl('canvas', { cls: 'cb-overlay' });
    this.octx = this.overlay.getContext('2d');
    root.createDiv({ cls: 'cb-vignette' });

    // top left: one quiet line per session; the header collapses it to coloured dots
    const tl = root.createDiv({ cls: 'cb-tl' });
    this.tlColEl = tl;
    const head = tl.createDiv({ cls: 'cb-head' });
    head.setAttr('title', 'Show or hide sessions (S)');
    this.headDots = head.createSpan({ cls: 'cb-head-dots' });
    head.createSpan({ cls: 'cb-head-t', text: 'Claude' });
    this.chipEl = head.createSpan({ cls: 'cb-chip' });
    this.chevEl = head.createSpan({ cls: 'cb-chev' });
    head.addEventListener('click', () => { if (this.mini) { this.plugin.activateView(); return; } this.plugin.settings.sessionsOpen = !this.plugin.settings.sessionsOpen; this.plugin.saveAll(); this.applyLayout(); });
    this.sessionsEl = tl.createDiv({ cls: 'cb-sessions' });
    this.regionsEl = tl.createDiv({ cls: 'cb-regions' });

    this.logEl = root.createDiv({ cls: 'cb-log' });
    this.captionEl = root.createDiv({ cls: 'cb-caption' });
    this.bannerEl = root.createDiv({ cls: 'cb-banner' });
    this.panelEl = root.createDiv({ cls: 'cb-panel' });

    // timeline drawer: one lane per session, click to replay
    this.tlEl = root.createDiv({ cls: 'cb-timeline' });
    const bar = this.tlEl.createDiv({ cls: 'cb-tl-bar' });
    this.tlInfo = bar.createSpan({ cls: 'cb-tl-info', text: 'Timeline' });
    const seg = () => bar.createDiv({ cls: 'cb-seg' });
    const btn = (host, label, title, fn, cls) => { const b = host.createEl('button', { cls: 'cb-tl-btn' + (cls ? ' ' + cls : ''), text: label }); b.setAttr('title', title); this.registerDomEvent(b, 'click', (e) => { e.stopPropagation(); fn(b); }); return b; };
    const sr = seg();
    this.rangeBtns = [[15, '15m'], [60, '1h'], [180, '3h'], [360, '6h']].map(([m, l]) => { const b = btn(sr, l, `Show the last ${l}`, () => { this.tlRange = m * 60000; this.drawTimeline(true); this.renderTlButtons(); }); b.dataset.m = String(m); return b; });
    const sp = seg();
    this.speedBtns = [5, 20, 60].map(x => { const b = btn(sp, x + '×', `Replay at ${x} times real speed`, () => { this.tlSpeed = x; if (this.replay) this.replay.speed = x; this.renderTlButtons(); }); b.dataset.x = String(x); return b; });
    this.liveBtn = btn(bar, 'Live', 'Back to live', () => this.stopReplay(), 'is-live');
    this.tlCanvas = this.tlEl.createEl('canvas', { cls: 'cb-tl-canvas' });
    this.tlCtx = this.tlCanvas.getContext('2d');

    // EEG-style traces, top right
    this.eegEl = root.createDiv({ cls: 'cb-eeg' });
    this.eegEl.setAttr('title', 'One trace per region (Fp frontal, C motor, P parietal, T temporal, O occipital). Each burst is a real event landing there; the background rhythm follows what Claude is doing. Press E to hide.');
    const eh = this.eegEl.createDiv({ cls: 'cb-eeg-h' });
    eh.createSpan({ text: 'EEG' });
    this.eegStateEl = eh.createSpan({ cls: 'cb-eeg-s', text: '' });
    this.eegCanvas = this.eegEl.createEl('canvas', { cls: 'cb-eeg-c' });
    this.eegCtx = this.eegCanvas.getContext('2d');

    // info popover: numbers, connections, shortcuts
    this.infoEl = root.createDiv({ cls: 'cb-info' });
    this.kpiEl = this.infoEl.createDiv({ cls: 'cb-kpis' });
    this.srcEl = this.infoEl.createDiv({ cls: 'cb-srcs' });
    const keys = this.infoEl.createDiv({ cls: 'cb-keys' });
    for (const [k, d] of [['S', 'Sessions'], ['A', 'Activity'], ['T', 'Timeline'], ['G', 'Regions'], ['E', 'EEG traces'], ['L', 'Anatomy layers'], ['V', 'Look: anatomy or atlas'], ['M', 'MRI slice'], ['H', 'Hide everything'], ['Space', 'Freeze time, inspect signals'], [', .', 'Slower / faster'], ['F', 'Follow activity'], ['R', 'Reset the view'], ['Esc', 'Close, back to live']]) {
      const r = keys.createDiv({ cls: 'cb-key-row' });
      r.createEl('kbd', { text: k }); r.createSpan({ text: d });
    }
    this.infoEl.createDiv({ cls: 'cb-info-foot', text: 'Brain surface: MNI ICBM152 2009, McConnell Brain Imaging Centre.' });

    // anatomy layers popover
    this.layersEl = root.createDiv({ cls: 'cb-pop cb-layers' });
    this.layersEl.createDiv({ cls: 'cb-pop-h', text: 'Look' });
    const segL = this.layersEl.createDiv({ cls: 'cb-seg cb-seg-wide cb-look' });
    this.lookBtns = [['anatomy', 'Anatomy', 'Realistic MRI glass'], ['atlas', 'Atlas', 'See-through brain: neurons, synapses and signals stand out']].map(([v, l, ttl]) => {
      const b = segL.createEl('button', { cls: 'cb-tl-btn', text: l }); b.setAttr('title', ttl + ' (V)');
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setLook(v); });
      return [v, b];
    });
    this.layersEl.createDiv({ cls: 'cb-pop-h', text: 'Anatomy' });
    for (const [key, label, sub] of [['showInner', 'Inner structures', 'Thalamus, basal ganglia, hippocampus, amygdala, ventricles'], ['showTracts', 'Fibre tracts', 'White-matter pathways from the HCP-1065 atlas'], ['showNotes', 'Notes and links', 'Your vault as neurons and synapses'], ['memoryTrace', 'Activity trace', 'Where the work happened, fading over hours'], ['showVitals', 'Body signals', 'CPU, memory and traffic of each machine']]) {
      const r = this.layersEl.createEl('label', { cls: 'cb-switch' });
      const box = r.createEl('input'); box.type = 'checkbox'; box.checked = this.plugin.settings[key] !== false;
      const t = r.createDiv({ cls: 'cb-switch-t' }); t.createDiv({ text: label }); t.createDiv({ cls: 'cb-switch-sub', text: sub });
      box.addEventListener('change', () => { this.plugin.settings[key] = box.checked; this.plugin.saveAll(); this.applyAnatomy(); });
      this.layersEl.addEventListener('click', (e) => e.stopPropagation());
    }
    // MRI slice popover
    this.sliceEl = root.createDiv({ cls: 'cb-pop cb-slice' });
    const sh = this.sliceEl.createDiv({ cls: 'cb-pop-h' }); sh.createSpan({ text: 'MRI slice' }); this.sliceVal = sh.createSpan({ cls: 'cb-pop-r' });
    const segA = this.sliceEl.createDiv({ cls: 'cb-seg cb-seg-wide' });
    this.axisBtns = [['x', 'Side', 'Sagittal: left to right'], ['z', 'Front', 'Coronal: front to back'], ['y', 'Top', 'Axial: top to bottom']].map(([ax, l, ttl]) => {
      const b = segA.createEl('button', { cls: 'cb-tl-btn', text: l }); b.setAttr('title', ttl); b.dataset.ax = ax;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.plugin.settings.sliceAxis = ax; this.plugin.saveAll(); this.applyAnatomy(); this.renderSliceUi(); });
      return b;
    });
    this.sliceRange = this.sliceEl.createEl('input', { cls: 'cb-range' });
    this.sliceRange.type = 'range'; this.sliceRange.min = '0'; this.sliceRange.max = '1000';
    this.sliceRange.addEventListener('input', () => { this.plugin.settings.slicePos = Number(this.sliceRange.value) / 1000; this.applyAnatomy(); this.renderSliceUi(); });
    this.sliceRange.addEventListener('change', () => this.plugin.saveAll());
    const cut = this.sliceEl.createEl('label', { cls: 'cb-switch' });
    this.cutBox = cut.createEl('input'); this.cutBox.type = 'checkbox';
    cut.createDiv({ cls: 'cb-switch-t' }).createDiv({ text: 'Fade the half in front' });
    this.cutBox.addEventListener('change', () => { this.plugin.settings.sliceCut = this.cutBox.checked; this.plugin.saveAll(); this.applyAnatomy(); });
    this.sliceEl.addEventListener('click', (e) => e.stopPropagation());

    // dock: the only always-there control; fades out while you just watch
    this.dockEl = root.createDiv({ cls: 'cb-dock' });
    const dockBtn = (key, icon, label, fn) => {
      const b = this.dockEl.createEl('button', { cls: 'cb-dock-btn' });
      b.setAttr('aria-label', label); b.setAttr('title', label);
      try { setIcon(b, icon); } catch (e) { b.setText(label[0]); }
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      (this.dockBtns || (this.dockBtns = {}))[key] = b;
      return b;
    };
    dockBtn('showSessions', 'users', 'Sessions (S)', () => this.toggleUi('showSessions'));
    dockBtn('showActivity', 'list', 'Activity (A)', () => this.toggleUi('showActivity'));
    dockBtn('showTimeline', 'history', 'Timeline (T)', () => this.toggleUi('showTimeline'));
    dockBtn('showRegions', 'brain', 'Regions (G)', () => this.toggleUi('showRegions'));
    dockBtn('showEeg', 'activity', 'EEG traces (E)', () => this.toggleUi('showEeg'));
    this.dockEl.createSpan({ cls: 'cb-dock-sep' });
    dockBtn('layers', 'layers', 'Anatomy layers (L)', () => this.togglePop('layers'));
    dockBtn('slice', 'scan-line', 'MRI slice (M)', () => this.toggleSlice());
    dockBtn('freeze', 'pause', 'Freeze time and look at the signals (Space)', () => this.toggleFreeze());
    this.dockEl.createSpan({ cls: 'cb-dock-sep' });
    dockBtn('info', 'info', 'Numbers, connections and shortcuts (I)', () => this.toggleInfo());
    this.registerDomEvent(root, 'click', () => { this.toggleInfo(false); this.togglePop('layers', false); });
    this.registerDomEvent(root, 'mousemove', () => this.wake());
    this.frozenEl = root.createDiv({ cls: 'cb-frozen-hint' });
    this.loadingEl = root.createDiv({ cls: 'cb-loading', text: 'loading brain model…' });

    try {
      [this.mesh, this.anat] = await Promise.all([this.plugin.loadBrainMesh(), this.plugin.loadAnatomy().catch((e) => { console.error('[agent-brain] anatomy', e); return {}; })]);
    } catch (e) {
      console.error('[agent-brain]', e);
      this.loadingEl.setText('Could not load the brain model: ' + (e && e.message ? e.message : e));
      return;
    }
    this.initGL();
    this.loadingEl.remove();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(root);
    this.bindInput();
    this.bindKeys();
    this.bindTimeline();
    await this.buildGraph();

    this.rebuildTimer = null;
    // 'resolved' fires after every edit; only rebuild when notes or links were added, removed or renamed
    this.registerEvent(this.app.metadataCache.on('resolved', () => {
      if (this.rebuildTimer) window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => { if (this.graphSignature() !== this.graphSig) this.buildGraph(); }, 4000);
    }));
    this.registerInterval(window.setInterval(() => { this.renderHud(); this.drawTimeline(); }, 1000));
    this.renderHud(); this.renderLog(); this.renderTlButtons(); this.applyLayout(); this.renderSliceUi(); this.renderLookUi();
    if (this.plugin.settings.sliceOn) this.togglePop('slice', true);

    this.running = true;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  async onClose() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    if (this.rebuildTimer) window.clearTimeout(this.rebuildTimer);
    if (this.hudTimer) window.clearTimeout(this.hudTimer);
    if (this.learnTimer) window.clearTimeout(this.learnTimer);
    if (this.flashT) window.clearTimeout(this.flashT);
    if (this.composer) this.composer.dispose();
    if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss(); }
    for (const o of [this.brainGeo, this.nodeGeo, this.linkGeo, this.spikeGeo]) if (o) o.dispose();
  }

  /* ---------- WebGL setup ---------- */

  initGL() {
    const m = this.mesh;
    // lobe borders follow the real gyri of the AAL atlas (the brain stem keeps its own label)
    if (this.anat && this.anat.aal && this.anat.aal.length === m.nv && !m.aalLobes) {
      for (let i = 0; i < m.nv; i++) { const l = AAL_LOBE[this.anat.aal[i]]; if (m.lobe[i] !== 7 && l >= 0) m.lobe[i] = l; }
      m.aalLobes = true;
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.qLevel = 0;
    renderer.setPixelRatio(this.qualityScale());
    renderer.setClearColor(0x030407, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    renderer.localClippingEnabled = true;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.glHost.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.addClass('cb-canvas');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030407);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 3000);

    // brain surface
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('aDepth', new THREE.BufferAttribute(m.depth, 1));
    g.setAttribute('aLobe', new THREE.BufferAttribute(m.lobe, 1));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeVertexNormals();
    this.brainGeo = g;
    this.initEngram();
    const pulse = [], pulseC = [], wave = [], waveC = [];
    for (let i = 0; i < MAXP; i++) { pulse.push(new THREE.Vector4(0, 0, 0, 1)); pulseC.push(new THREE.Vector4(0, 0, 0, 0)); }
    for (let i = 0; i < MAXW; i++) { wave.push(new THREE.Vector4(0, 0, 0, 0)); waveC.push(new THREE.Vector4(0, 0, 0, 0)); }
    this.brainMat = new THREE.ShaderMaterial({
      vertexShader: BRAIN_VS, fragmentShader: BRAIN_FS,
      uniforms: {
        uPulse: { value: pulse }, uPulseC: { value: pulseC }, uWave: { value: wave }, uWaveC: { value: waveC },
        uNP: { value: 0 }, uNW: { value: 0 },
        uDim: { value: new Array(8).fill(1) },
        uEngK: { value: 1 }, uEngOn: { value: 1 },
        uCut: { value: new THREE.Vector4(1, 0, 0, 0) }, uCutOn: { value: 0 },
        uLight: { value: new THREE.Vector3(-0.4, 0.8, -0.45) },
        uBase: { value: new THREE.Color(0x5d6a82) },
        uRim: { value: new THREE.Color(0x5b8dff).multiplyScalar(0.42) },
        uGlass: { value: this.plugin.settings.glass },
        uLook: { value: this.plugin.settings.look === 'atlas' ? 1 : 0 },
      },
      transparent: true, depthWrite: true, side: THREE.FrontSide, clipping: true,
    });
    const brain = new THREE.Mesh(g, this.brainMat);
    this.brainMesh = brain;
    brain.renderOrder = 0;
    scene.add(brain);

    // hemisphere and lobe centroids (from surface vertices)
    const nrm = g.getAttribute('normal').array;
    this.vNormal = nrm;
    const acc = {};
    for (let i = 0; i < m.nv; i++) {
      const k = LOBE_ORDER[m.lobe[i]] + (m.pos[i * 3] < 0 ? 'L' : 'R');
      const a = acc[k] || (acc[k] = { x: 0, y: 0, z: 0, n: 0, list: [] });
      a.x += m.pos[i * 3]; a.y += m.pos[i * 3 + 1]; a.z += m.pos[i * 3 + 2]; a.n++; a.list.push(i);
    }
    for (const k in acc) {
      const a = acc[k]; a.x /= a.n; a.y /= a.n; a.z /= a.n;
      // surface anchor: vertex nearest the outward projection of the centroid (so glows land as round patches on the cortex)
      const L = Math.hypot(a.x, a.y, a.z) || 1, tx = a.x * (1 + 40 / L), ty = a.y * (1 + 40 / L), tz = a.z * (1 + 40 / L);
      let best = -1, bd = Infinity;
      for (const i of a.list) { const d = (m.pos[i * 3] - tx) ** 2 + (m.pos[i * 3 + 1] - ty) ** 2 + (m.pos[i * 3 + 2] - tz) ** 2; if (d < bd) { bd = d; best = i; } }
      a.surf = best >= 0 ? { x: m.pos[best * 3], y: m.pos[best * 3 + 1], z: m.pos[best * 3 + 2] } : { x: a.x, y: a.y, z: a.z };
      // a few well-separated outer-surface anchors, so several sessions "breathing" in one lobe don't overlap
      const outer = a.list.filter((i) => {
        const px = m.pos[i * 3] - a.x, py = m.pos[i * 3 + 1] - a.y, pz = m.pos[i * 3 + 2] - a.z;
        const ox = m.pos[i * 3], oy = m.pos[i * 3 + 1] + 6, oz = m.pos[i * 3 + 2];
        const ol = Math.hypot(ox, oy, oz) || 1;
        return m.depth[i] > 0.55 && (nrm[i * 3] * ox + nrm[i * 3 + 1] * oy + nrm[i * 3 + 2] * oz) / ol > 0.55 && px * px + py * py + pz * pz < 45 * 45;
      });
      const anchors = [a.surf];
      for (let k = 1; k < 4 && outer.length; k++) {
        let bi = -1, bv = -1;
        for (let j = 0; j < outer.length; j += 3) {
          const i = outer[j];
          let md = Infinity;
          for (const q of anchors) md = Math.min(md, (m.pos[i * 3] - q.x) ** 2 + (m.pos[i * 3 + 1] - q.y) ** 2 + (m.pos[i * 3 + 2] - q.z) ** 2);
          if (md > bv) { bv = md; bi = i; }
        }
        if (bi < 0 || bv < 14 * 14) break;
        anchors.push({ x: m.pos[bi * 3], y: m.pos[bi * 3 + 1], z: m.pos[bi * 3 + 2] });
      }
      a.anchors = anchors;
    }
    acc.thalamusL = { x: -THALAMUS.x, y: THALAMUS.y, z: THALAMUS.z, n: 0, list: [] };
    acc.thalamusR = { x: THALAMUS.x, y: THALAMUS.y, z: THALAMUS.z, n: 0, list: [] };
    if (!acc.stemL) acc.stemL = { ...STEM, n: 0, list: [] };
    if (!acc.stemR) acc.stemR = { ...STEM, n: 0, list: [] };
    this.regions = acc;

    // post-processing: bloom
    this.initAnatomy();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.42, 0.42);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // render scale: the brain doesn't need retina resolution; "auto" steps down if frames run long
  qualityScale() {
    const dpr = window.devicePixelRatio || 1, q = this.plugin.settings.quality;
    if (q === 'high') return Math.min(2, dpr);
    if (q === 'low') return Math.min(1, dpr);
    const steps = [Math.min(1.5, dpr), Math.min(1.25, dpr), Math.min(1, dpr), Math.min(0.8, dpr)];
    return steps[Math.min(this.qLevel || 0, steps.length - 1)];
  }
  applyQuality() {
    if (!this.renderer) return;
    const r = this.qualityScale();
    this.renderer.setPixelRatio(r);
    this.composer.setPixelRatio(r);
    this.resize();
    this.needsDraw = true;
  }
  // frame timing: rolling average of the interval between consecutive drawn frames
  trackFrame(now) {
    const prev = this.lastFrameAt;
    this.lastFrameAt = now;
    if (!prev || now - prev > 250) { this.slowSince = 0; return; }
    const dtm = now - prev;
    this.ft = this.ft ? this.ft * 0.94 + dtm * 0.06 : dtm;
    const expected = this.plugin.settings.fps === 30 ? 1000 / 30 : 1000 / 60;
    if (this.plugin.settings.quality !== 'auto') return;
    if (this.ft > expected * 1.35) {
      if (!this.slowSince) this.slowSince = now;
      else if (now - this.slowSince > 2500 && (this.qLevel || 0) < 3) { this.qLevel = (this.qLevel || 0) + 1; this.slowSince = 0; this.ft = expected; this.applyQuality(); }
    } else this.slowSince = 0;
  }

  /* ---------- full anatomy: gyri, inner structures, fibre tracts, MRI slice ---------- */

  initAnatomy() {
    const A = this.anat || {};
    const G = this.plugin.ensureGeo(this.mesh, A);
    this.gyrusAnchor = G.anchors;
    if (A.aal && A.aal.length === this.mesh.nv) this.aalLabel = A.aal;
    this.clipMats = [];
    const light = this.brainMat.uniforms.uLight.value;
    this.inner = A.inner ? makeInner(A.inner, light) : [];
    this.innerBy = {};
    for (const it of this.inner) { this.scene.add(it.mesh); (this.innerBy[it.name] || (this.innerBy[it.name] = [])).push(it); this.clipMats.push(it.mat); }
    this.tractLines = [];
    if (A.tracts && A.tracts.length) {
      const t = makeTracts(A.tracts);
      // not clipped: with a slice open the fibres switch to "only what runs through the slice" instead
      this.tractObj = t.obj; this.tractMat = t.mat; this.tractRanges = t.ranges; this.tractUse = t.use; this.tractUseAttr = t.useAttr; this.scene.add(t.obj);
      this.tractLines = A.tracts.map(l => {
        const p = l.pts, n = p.length / 3, cum = new Float32Array(n);
        for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]);
        return { ...l, cum, len: cum[n - 1] };
      });
      this.tractByPair = new Map();
      this.tractLines.forEach((l, i) => {
        const k = Math.min(l.ea, l.eb) + '|' + Math.max(l.ea, l.eb);
        (this.tractByPair.get(k) || this.tractByPair.set(k, []).get(k)).push(i);
      });
      this.tractRelay = this.tractLines.map((l, i) => i).filter(i => /^TR_/.test(this.tractLines[i].bundle));
    }
    this.tractSpikes = [];
    this.slice = A.t1 ? makeSlice(A.t1, this.brainMat.uniforms, MAXP) : null;
    this.gyrusTurn = {};
    this.lastLobe = {};
    this.loadEngram();
    this.applyAnatomy();
  }

  // layers and slice follow the settings
  applyAnatomy() {
    const st = this.plugin.settings;
    for (const it of this.inner || []) it.mesh.visible = st.showInner !== false;
    if (this.tractObj) this.tractObj.visible = st.showTracts !== false;
    if (this.nodeObj) this.nodeObj.visible = st.showNotes !== false;
    if (this.linkObj) this.linkObj.visible = st.showNotes !== false;
    if (this.learnObj) this.learnObj.visible = st.showNotes !== false;
    const sliceOn = !!(this.slice && st.sliceOn);
    if (this.slice) {
      if (sliceOn && !this.slice.mesh.parent) this.scene.add(this.slice.mesh);
      if (!sliceOn && this.slice.mesh.parent) this.scene.remove(this.slice.mesh);
      if (sliceOn) this.sliceAt = this.slice.set(st.sliceAxis || 'x', st.slicePos == null ? 0.5 : st.slicePos);
    }
    if (this.tractMat) this.tractMat.uniforms.uSlabOn.value = sliceOn ? 1 : 0;
    const clip = sliceOn && st.sliceCut !== false;
    if (clip !== this.clipOn) {
      this.clipOn = clip;
      const mats = (this.clipMats || []).concat([this.nodeObj && this.nodeObj.material, this.spikeObj && this.spikeObj.material, this.linkObj && this.linkObj.material, this.learnObj && this.learnObj.material].filter(Boolean));
      // while cut open, everything respects depth so what lies behind the slice stays behind it
      for (const mt of mats) { mt.clippingPlanes = clip ? [this.clipPlane] : null; mt.depthTest = clip; mt.needsUpdate = true; }
      this.brainMat.uniforms.uCutOn.value = clip ? 1 : 0;
    }
    this.needsDraw = true;
  }

  // cut away whichever half of the brain faces the camera, so the slice and what is inside stay visible
  updateClip() {
    if (!this.slice || !this.slice.mesh.parent) return;
    const axis = this.plugin.settings.sliceAxis || 'x', c = this.camera.position, v = this.sliceAt;
    if (this.tractMat) this.tractMat.uniforms.uSlab.value.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0, -v);
    if (!this.clipOn) return;
    const n = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const camSide = (axis === 'x' ? c.x : axis === 'y' ? c.y : c.z) > v ? 1 : -1;
    n.multiplyScalar(-camSide);                     // keep the far side
    this.clipPlane.set(n, camSide * v);
    this.brainMat.uniforms.uCut.value.set(n.x, n.y, n.z, camSide * v);
  }

  gyrusFor(cat, key) {
    const label = this.plugin.labelFor(cat, key == null ? (this.gyrusTurn[cat] = (this.gyrusTurn[cat] || 0) + 1) : key);
    return this.gyrusAnchor[label] || null;
  }

  // which deep nucleus takes part in each kind of work
  innerFor(cat, hex, k) {
    k = k || 1;
    const n = NUCLEUS[cat] || 'Thalamus';
    this.innerAct(n, hex, (n === 'Thalamus' ? 0.35 : 0.7) * k);
    if (n !== 'Thalamus') this.innerAct('Thalamus', '#dfe8ff', 0.2 * k);
  }

  innerAct(name, hex, amt) {
    for (const it of (this.innerBy && this.innerBy[name]) || []) {
      const k = amt * (this._k == null ? 1 : this._k);
      if (k > it.act) { it.act = k; it.actColor.set(hex); }
    }
  }

  /* ---------- signals along real fibres ---------- */

  // a spike along one fibre. f = { i, toEnd } from the plugin's routing; back = from the target home again
  // src says what the spike carries (the event, the session, the strike), so a frozen frame can be inspected
  signal(f, hex, k, onEnd, back, speed, src) {
    const l = f && this.tractLines && this.tractLines[f.i];
    if (!l || this.tractSpikes.length >= 260) { if (onEnd) onEnd(); return; }
    const fwd = back ? !f.toEnd : !!f.toEnd;
    this.tractSpikes.push({ l, li: f.i, t: 0, speed: (speed || 120) / Math.max(30, l.len), fwd, hex, c: typeof hex === 'string' ? col3(hex) : hex, k: k == null ? 1 : k, onEnd, back: !!back, src: src || this._src || null });
  }
  signalNear(kind, target, hex, k, onEnd, back, speed, src) {
    this.signal(this.plugin.fibreNear(ROUTES[kind], target), hex, k, onEnd, back, speed, src ? Object.assign({ kind }, src) : this._src ? Object.assign({}, this._src, { kind }) : null);
  }
  // along any fibre of these bundles, upwards (brain stem to cortex) or down
  signalUp(kind, hex, k, onEnd, down, speed, src) {
    const f = this.plugin.fibreAny(kind), E = this.plugin.geo && this.plugin.geo.ends;
    if (!f || !E) { if (onEnd) onEnd(); return; }
    const upIsEnd = E[f.i * 6 + 4] > E[f.i * 6 + 1];
    this.signal({ i: f.i, toEnd: down ? !upIsEnd : upIsEnd }, hex, k, onEnd, false, speed, src ? Object.assign({ kind }, src) : this._src ? Object.assign({}, this._src, { kind }) : null);
  }

  // one strike of an action: a spike runs along its fibre and the gyrus lights up as it arrives
  strike(st, sc, k, delay, o) {
    o = o || {};
    const g = this.gyrusAnchor[st.label];
    const src = o.src || (this._src ? Object.assign({}, this._src, { st }) : null);
    const run = () => {
      const arrive = () => {
        if (g) this.pulse(g, st.hex, (o.amp || 0.6) * k, o.sigma || 9, o.life || 2.4);
        if (st.nucleus && o.nucleus !== false) this.innerAct(st.nucleus, st.hex, 0.7 * k);
        if (o.onArrive) o.onArrive(g);
      };
      if (g && !o.back) this.pulse(g, st.hex, 0.1 * k, 6, 0.9);       // a faint first response while the signal travels
      if (st.fibre) this.signal(st.fibre, o.spikeHex || sc, k, arrive, o.back, o.speed, src); else arrive();
    };
    if (delay) window.setTimeout(run, delay); else run();
  }

  // the tool call finished: a crisp flash where the work happened, and the result travels back along the same fibre
  strikeBack(st, sc, k, delay, extra) {
    const g = this.gyrusAnchor[st.label];
    const src = this._src ? Object.assign({}, this._src, { st }) : null;
    const run = () => {
      if (g) this.pulse(g, st.hex, 0.4 * k, 6, 1.1);
      const home = () => { this.pulse(THALAMUS, '#e6eeff', 0.16 * k, 7, 1.2); this.innerAct('Thalamus', '#e6eeff', 0.3 * k); };
      if (st.fibre) {
        this.signal(st.fibre, '#e6eeff', k * 0.9, home, true, 140, src);
        for (let j = 0; j < (extra || 0); j++) window.setTimeout(() => this.signal(st.fibre, sc, k * 0.6, null, true, 140, src), 90 * (j + 1));
      } else home();
    };
    if (delay) window.setTimeout(run, delay); else run();
  }

  // a signal travelling along real white-matter tracts between two lobes
  tractSignal(fromLobe, toLobe, hex, count) {
    if (!this.tractLines || !this.tractLines.length) return;
    const a = LOBE_ORDER.indexOf(fromLobe), b = LOBE_ORDER.indexOf(toLobe);
    if (a < 0 || b < 0) return;
    let pool = this.tractByPair.get(Math.min(a, b) + '|' + Math.max(a, b)) || [];
    if (!pool.length) pool = this.tractLines.map((l, i) => i).filter(i => this.tractLines[i].ea === b || this.tractLines[i].eb === b);
    const c = col3(hex);
    for (const i of shuffled(pool, count || 3)) {
      const l = this.tractLines[i];
      const fwd = l.ea === a || (l.eb !== a && Math.random() < 0.5);
      if (this.tractSpikes.length < 260) this.tractSpikes.push({ l, li: i, t: 0, speed: 90 / Math.max(30, l.len), fwd, hex, c, k: this._k == null ? 1 : this._k, src: this._src ? Object.assign({}, this._src, { relay: true }) : null });
    }
  }
  relaySignal(hex, count) {
    if (!this.tractRelay || !this.tractRelay.length) return;
    const c = col3(hex);
    for (const i of shuffled(this.tractRelay, count || 4)) {
      const l = this.tractLines[i];
      // thalamic radiations start at the thalamus end (the end nearest the middle)
      const p = l.pts, n = p.length / 3;
      const d0 = Math.hypot(p[0], p[1] + 3, p[2] - 3), d1 = Math.hypot(p[n * 3 - 3], p[n * 3 - 2] + 3, p[n * 3 - 1] - 3);
      if (this.tractSpikes.length < 260) this.tractSpikes.push({ l, li: i, t: 0, speed: 90 / Math.max(30, l.len), fwd: d0 < d1, hex, c, k: this._k == null ? 1 : this._k, src: this._src ? Object.assign({}, this._src, { relay: true }) : null });
    }
  }

  /* ---------- engram: the lasting trace on the cortex, the nuclei and the fibres ---------- */

  initEngram() {
    const m = this.mesh, nv = m.nv, P = m.pos;
    this.eng = new Float32Array(nv * 3);
    this.engAttr = new THREE.BufferAttribute(this.eng, 3);
    this.engAttr.setUsage(THREE.DynamicDrawUsage);
    this.brainGeo.setAttribute('aEng', this.engAttr);
    const C = 8, cells = new Map();
    for (let i = 0; i < nv; i++) {
      const k = engCell(Math.floor(P[i * 3] / C), Math.floor(P[i * 3 + 1] / C), Math.floor(P[i * 3 + 2] / C));
      let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(i);
    }
    for (const [k, a] of cells) cells.set(k, Int32Array.from(a));
    this.engCells = cells; this.engC = C;
  }
  // add rgb * f around a point of the cortex (f already in the plugin's time base)
  engSpot(p, r, g, b, sigma) {
    if (!this.eng || !p) return;
    const s2 = sigma * sigma, R = sigma * 2.2, R2 = R * R, C = this.engC, P = this.mesh.pos, E = this.eng;
    for (let x = Math.floor((p.x - R) / C); x <= Math.floor((p.x + R) / C); x++)
      for (let y = Math.floor((p.y - R) / C); y <= Math.floor((p.y + R) / C); y++)
        for (let z = Math.floor((p.z - R) / C); z <= Math.floor((p.z + R) / C); z++) {
          const a = this.engCells.get(engCell(x, y, z));
          if (!a) continue;
          for (let j = 0; j < a.length; j++) {
            const i = a[j], dx = P[i * 3] - p.x, dy = P[i * 3 + 1] - p.y, dz = P[i * 3 + 2] - p.z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > R2) continue;
            const k = Math.exp(-d2 / s2);
            E[i * 3] += r * k; E[i * 3 + 1] += g * k; E[i * 3 + 2] += b * k;
          }
        }
    this.engDirty = true;
  }
  // rebuild everything from the plugin's stored engram (on open, and when it is rescaled)
  loadEngram() {
    if (!this.eng) return;
    const E = this.plugin.engram;
    this.eng.fill(0);
    for (const l in E.a) { const v = E.a[l]; this.engSpot(this.gyrusAnchor[l], v[0], v[1], v[2], ENG_SIGMA); }
    for (const it of this.inner || []) { it.eng = 0; it.engC.setRGB(0, 0, 0); }
    for (const n in E.n) for (const it of (this.innerBy && this.innerBy[n]) || []) { const v = E.n[n]; it.engC.setRGB(v[0], v[1], v[2]); it.eng = Math.max(v[0], v[1], v[2]); }
    if (this.tractUse) {
      this.tractUse.fill(0);
      for (const i in E.f) this.useFibre(Number(i), E.f[i]);
    }
    this.engDirty = true; this.useDirty = true;
  }
  useFibre(i, f) {
    if (!this.tractUse || !this.tractRanges || i < 0 || i * 2 >= this.tractRanges.length) return;
    const s0 = this.tractRanges[i * 2], n = this.tractRanges[i * 2 + 1], U = this.tractUse;
    for (let v = s0; v < s0 + n; v++) U[v] += f;
    this.useDirty = true;
  }
  // the plugin stored new strikes: add them here too (f = weight in the plugin's time base)
  onEngram(strikes, f0) {
    for (const st of strikes) {
      const c = col3(st.hex), f = st.w * f0;
      this.engSpot(this.gyrusAnchor[st.label], c.r * f, c.g * f, c.b * f, ENG_SIGMA);
      if (st.nucleus) for (const it of (this.innerBy && this.innerBy[st.nucleus]) || []) { it.engC.r += c.r * f * 0.6; it.engC.g += c.g * f * 0.6; it.engC.b += c.b * f * 0.6; it.eng = Math.max(it.engC.r, it.engC.g, it.engC.b); }
      if (st.fibre) this.useFibre(st.fibre.i, f * 0.7);
    }
  }

  tractPoint(l, t, out) {
    const target = t * l.len, cum = l.cum, p = l.pts;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const m2 = (lo + hi) >> 1; if (cum[m2] < target) lo = m2; else hi = m2; }
    const f = cum[hi] > cum[lo] ? (target - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    out.x = p[lo * 3] + (p[hi * 3] - p[lo * 3]) * f; out.y = p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * f; out.z = p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * f;
    return out;
  }

  // what is under the mouse: a cortical gyrus or an inner structure (cheap: projects vertices, no ray cast)
  pickAnatomy(sx, sy) {
    if (!this.camera || !this.mesh) return null;
    const M = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const W = this.cssW, H = this.cssH, r2 = 36;
    const cl = this.clipOn ? this.clipPlane : null, cn = cl && cl.normal;
    let bz = Infinity, bi = -1, bsrc = null;
    const scan = (pos, step, src) => {
      for (let i = 0, n = pos.length / 3; i < n; i += step) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const w = M[3] * x + M[7] * y + M[11] * z + M[15];
        if (w <= 0) continue;
        const dx = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / w * 0.5 + 0.5) * W - sx;
        const dy = (-(M[1] * x + M[5] * y + M[9] * z + M[13]) / w * 0.5 + 0.5) * H - sy;
        if (dx * dx + dy * dy > r2) continue;
        if (cl && cn.x * x + cn.y * y + cn.z * z + cl.constant < 0) continue;
        const zz = (M[2] * x + M[6] * y + M[10] * z + M[14]) / w;
        if (zz < bz) { bz = zz; bi = i; bsrc = src; }
      }
    };
    if (this.plugin.settings.showInner !== false) for (const it of this.inner || []) if (it.kind !== 'csf' && it.mesh.visible) scan(it.pos, 2, it);
    // inner structures are drawn over the glass cortex, so when one is under the mouse it is what you are looking at
    if (bi < 0 || cl) scan(this.mesh.pos, 1, 'cortex');
    if (bi < 0) return null;
    if (bsrc === 'cortex') return { kind: 'cortex', label: this.aalLabel ? this.aalLabel[bi] : 0, lobe: LOBE_ORDER[Math.round(this.mesh.lobe[bi])] };
    return { kind: 'inner', name: bsrc.name, side: bsrc.side, item: bsrc };
  }

  showTip(sx, sy) {
    if (!this.tipEl) this.tipEl = this.contentEl.createDiv({ cls: 'cb-tip' });
    if (this.frozen && this.hoverSpike) return;
    this.tipEl.removeClass('is-rich');
    const hit = this.hover ? null : this.pickAnatomy(sx, sy);
    if (!hit) { this.tipEl.removeClass('is-on'); return; }
    let text = '';
    if (hit.kind === 'inner') text = `${hit.name}${hit.side ? ', ' + (hit.side === 'L' ? 'left' : 'right') : ''}`;
    else if (hit.label) text = aalName(hit.label);
    if (!text) { this.tipEl.removeClass('is-on'); return; }
    this.tipEl.setText(text);
    this.tipEl.style.left = Math.min(this.cssW - 220, sx + 14) + 'px';
    this.tipEl.style.top = (sy + 12) + 'px';
    this.tipEl.addClass('is-on');
  }

  makePoints(n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VS, fragmentShader: POINT_FS,
      uniforms: { uScale: { value: 300 }, uRing: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, clipping: true,
    });
    if (this.clipOn) mat.clippingPlanes = [this.clipPlane];
    return { g, mat };
  }

  /* ---------- place notes into lobes ---------- */

  lobeForFile(f) {
    const cache = this.app.metadataCache.getFileCache ? this.app.metadataCache.getFileCache(f) : null;
    const fm = cache && cache.frontmatter;
    const want = fm && (fm.lobe || fm['brain-lobe']);
    if (want && LOBES[String(want).toLowerCase()]) return String(want).toLowerCase();
    // top-down through the folder path: the first matching folder name wins (projects/api/memory → frontal)
    const segs = f.path.split('/').slice(0, -1);
    for (const seg of segs) for (const [re, lobe] of LOBE_RULES) if (re.test('/' + seg + '/')) return lobe;
    for (const [re, lobe] of LOBE_RULES) if (re.test('/' + f.basename + '/')) return lobe;
    return null;
  }

  graphSignature() {
    const files = this.app.vault.getMarkdownFiles();
    let h = files.length >>> 0, n = 0;
    for (const f of files) h = (Math.imul(h, 31) + strHash(f.path)) >>> 0;
    const rl = this.app.metadataCache.resolvedLinks || {};
    for (const a in rl) for (const b in rl[a]) { h = (h ^ strHash(a + '>' + b)) >>> 0; n++; }
    return h + ':' + files.length + ':' + n;
  }

  async buildGraph() {
    if (!this.scene) return;
    this.graphSig = this.graphSignature();
    const files = this.app.vault.getMarkdownFiles();
    const clusterKey = (p) => { const s = p.split('/'); return s.length > 2 ? s[0] + '/' + s[1] : s.length === 2 ? s[0] : '(root)'; };
    const clusters = new Map();
    for (const f of files) {
      const key = clusterKey(f.path);
      let c = clusters.get(key);
      if (!c) { c = { key, files: [], lobe: null }; clusters.set(key, c); }
      c.files.push(f);
    }
    const load = Object.fromEntries(LOBE_ORDER.map(k => [k, 0]));
    const pending = [];
    for (const c of clusters.values()) {
      const votes = {};
      for (const f of c.files) { const l = this.lobeForFile(f); if (l) votes[l] = (votes[l] || 0) + 1; }
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      if (best) { c.lobe = best[0]; load[c.lobe] += c.files.length; } else pending.push(c);
    }
    for (const c of pending.sort((a, b) => b.files.length - a.files.length)) {
      const pick = ['parietal', 'frontal', 'occipital', 'motor', 'temporal'].sort((a, b) => load[a] - load[b])[0];
      c.lobe = pick; load[pick] += c.files.length;
    }

    const P = this.mesh.pos, Nn = this.vNormal;
    const old = this.byPath;
    const nodes = [], byPath = new Map();
    for (const c of clusters.values()) {
      const lobe = c.lobe, h = strHash(c.key);
      const sides = c.files.length > 50 ? ['L', 'R'] : [(h & 1) ? 'R' : 'L'];
      const centers = sides.map((side, si) => {
        const reg = this.regions[lobe + side];
        if (!reg || !reg.list.length) return { reg, pool: null };
        const seed = reg.list[(h >>> (3 + si)) % reg.list.length];
        const spread = Math.max(40, Math.ceil(c.files.length / sides.length) * 10);
        const ck = lobe + side + ':' + seed + ':' + spread;
        let near = this.poolCache.get(ck);
        if (!near) {
          const sx = P[seed * 3], sy = P[seed * 3 + 1], sz = P[seed * 3 + 2];
          near = reg.list.map(i => [i, (P[i * 3] - sx) ** 2 + (P[i * 3 + 1] - sy) ** 2 + (P[i * 3 + 2] - sz) ** 2])
            .sort((a, b) => a[1] - b[1]).slice(0, spread).map(e => e[0]);
          this.poolCache.set(ck, near);
        }
        return { reg, pool: near };
      });
      c.files.forEach((f, i) => {
        const ctr = centers[i % centers.length];
        const hh = strHash(f.path);
        const r1 = (hh & 0xffff) / 0xffff, r2 = ((hh >>> 16) & 0xffff) / 0xffff;
        let x, y, z;
        if (!ctr.pool) {
          const base = ctr.reg || (lobe === 'stem' ? STEM : THALAMUS);
          const u = r1 * 2 - 1, a = r2 * Math.PI * 2, rr = Math.sqrt(1 - u * u), s = lobe === 'stem' ? 7 : 6;
          x = base.x + Math.cos(a) * rr * s; y = base.y + u * s; z = base.z + Math.sin(a) * rr * s * 1.4;
        } else {
          const vi = ctr.pool[Math.floor(r1 * ctr.pool.length)];
          const depth = 2.5 + r2 * 4; // just beneath the cortex (mm)
          x = P[vi * 3] - Nn[vi * 3] * depth; y = P[vi * 3 + 1] - Nn[vi * 3 + 1] * depth; z = P[vi * 3 + 2] - Nn[vi * 3 + 2] * depth;
        }
        const prev = old.get(f.path);
        const n = { path: f.path, name: f.basename, lobe, x, y, z, deg: 0, adj: [], act: prev ? prev.act : 0, actColor: col3(SIGNAL), labelT: 0, hub: lobe === 'thalamus', sx: 0, sy: 0, vis: true };
        nodes.push(n); byPath.set(f.path, n);
      });
    }
    // learned neurons: files outside the vault that Claude worked with, clustered per project inside their lobe
    const L = this.plugin.learned, tnow = Date.now();
    let nLearned = 0;
    for (const key in L.neurons) {
      const nn = L.neurons[key];
      const lobe = LOBES[nn.lobe] && nn.lobe !== 'thalamus' && nn.lobe !== 'stem' ? nn.lobe : 'parietal';
      const h = strHash(nn.proj + '|' + lobe);
      const side = (h & 1) ? 'R' : 'L';
      const reg = this.regions[lobe + side] && this.regions[lobe + side].list.length ? this.regions[lobe + side] : this.regions[lobe + (side === 'L' ? 'R' : 'L')];
      if (!reg || !reg.list.length) continue;
      const seed = reg.list[(h >>> 3) % reg.list.length];
      const ck = 'learn:' + lobe + side + ':' + seed;
      let pool = this.poolCache.get(ck);
      if (!pool) {
        const sx = P[seed * 3], sy = P[seed * 3 + 1], sz = P[seed * 3 + 2];
        pool = reg.list.map(i => [i, (P[i * 3] - sx) ** 2 + (P[i * 3 + 1] - sy) ** 2 + (P[i * 3 + 2] - sz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 220).map(e => e[0]);
        this.poolCache.set(ck, pool);
      }
      const hh = strHash(key);
      const vi = pool[hh % pool.length];
      const depth = 1.5 + ((hh >>> 12) & 0xff) / 255 * 3;
      const prev = old.get(key);
      const w = this.plugin.decayW(nn, tnow);
      const n = { path: key, name: nn.name, lobe, learned: true, file: nn.path, proj: nn.proj, w, uses: nn.n,
        x: P[vi * 3] - Nn[vi * 3] * depth, y: P[vi * 3 + 1] - Nn[vi * 3 + 1] * depth, z: P[vi * 3 + 2] - Nn[vi * 3 + 2] * depth,
        deg: 0, adj: [], act: prev ? prev.act : 0, actColor: col3(SIGNAL), labelT: 0, hub: false, sx: 0, sy: 0, vis: true, firedAt: prev ? prev.firedAt : 0 };
      nodes.push(n); byPath.set(key, n); nLearned++;
    }

    const links = [], seen = new Set();
    const rl = this.app.metadataCache.resolvedLinks || {};
    for (const src in rl) {
      const a = byPath.get(src); if (!a) continue;
      for (const dst in rl[src]) {
        const b = byPath.get(dst); if (!b || a === b) continue;
        const key = a.path < b.path ? a.path + '|' + b.path : b.path + '|' + a.path;
        if (seen.has(key)) continue; seen.add(key);
        // control point pulled into white matter so fibers run through the brain
        const c = { x: (a.x + b.x) * 0.28, y: (a.y + b.y) * 0.28 - 4, z: (a.z + b.z) * 0.28 };
        const l = { a, b, c };
        links.push(l); a.deg++; b.deg++;
        a.adj.push({ n: b, l }); b.adj.push({ n: a, l });
      }
    }
    // learned synapses: pairs of files a session used back to back; stronger with reuse
    const learnedLinks = new Map();
    const node = (k) => k.startsWith('n:') ? byPath.get(k.slice(2)) : byPath.get(k);
    for (const sk in L.synapses) {
      const sy = L.synapses[sk];
      const a = node(sy.a), b = node(sy.b);
      if (!a || !b || a === b) continue;
      const vk = a.path < b.path ? a.path + '|' + b.path : b.path + '|' + a.path;
      const w = this.plugin.decayW(sy, tnow);
      if (seen.has(vk)) { const ex = links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a)); if (ex) { ex.w = w; learnedLinks.set(sk, ex); } continue; }
      seen.add(vk);
      const c = { x: (a.x + b.x) * 0.36, y: (a.y + b.y) * 0.36 - 3, z: (a.z + b.z) * 0.36 };
      const l = { a, b, c, learned: true, w };
      links.push(l); a.deg++; b.deg++;
      a.adj.push({ n: b, l }); b.adj.push({ n: a, l });
      learnedLinks.set(sk, l);
    }
    const nLearnedSyn = [...learnedLinks.values()].filter(l => l.learned).length;
    for (const n of nodes) n.size = n.learned ? 2.2 + Math.min(2.4, n.w * 0.3) : n.hub ? Math.min(3.6 + Math.sqrt(n.deg) * 0.4, 7) : Math.min(2.6 + Math.sqrt(n.deg) * 0.45, 6);

    // GPU objects
    for (const o of [this.nodeObj, this.linkObj, this.spikeObj, this.learnObj]) if (o) { this.scene.remove(o); o.geometry.dispose(); }
    const np = this.makePoints(nodes.length);
    this.nodeGeo = np.g; this.nodeObj = new THREE.Points(np.g, np.mat); this.nodeObj.renderOrder = 3; this.nodeObj.frustumCulled = false;
    this.scene.add(this.nodeObj);
    const SEG = 10;
    const vlinks = links.filter(l => !l.learned), llinks = links.filter(l => l.learned);
    const lp = new Float32Array(vlinks.length * SEG * 2 * 3);
    const lc = new Float32Array(vlinks.length * SEG * 2 * 3);
    // fibres converge on the hub notes in the middle; fade them there so the centre doesn't flare
    const fade = (x, y, z) => {
      const d = Math.min(Math.hypot(x - THALAMUS.x, y - THALAMUS.y, z - THALAMUS.z), Math.hypot(x + THALAMUS.x, y - THALAMUS.y, z - THALAMUS.z));
      return 0.12 + 0.88 * Math.min(1, Math.max(0, (d - 8) / 40));
    };
    let o = 0;
    for (const l of vlinks) {
      let px = l.a.x, py = l.a.y, pz = l.a.z;
      for (let s = 1; s <= SEG; s++) {
        const t = s / SEG, u = 1 - t;
        const x = u * u * l.a.x + 2 * u * t * l.c.x + t * t * l.b.x, y = u * u * l.a.y + 2 * u * t * l.c.y + t * t * l.b.y, z = u * u * l.a.z + 2 * u * t * l.c.z + t * t * l.b.z;
        const f0 = fade(px, py, pz), f1 = fade(x, y, z);
        lc[o] = lc[o + 1] = lc[o + 2] = f0; lc[o + 3] = lc[o + 4] = lc[o + 5] = f1;
        lp[o++] = px; lp[o++] = py; lp[o++] = pz; lp[o++] = x; lp[o++] = y; lp[o++] = z;
        px = x; py = y; pz = z;
      }
    }
    this.linkGeo = new THREE.BufferGeometry();
    this.linkGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    this.linkGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    this.linkObj = new THREE.LineSegments(this.linkGeo, new THREE.LineBasicMaterial({ color: 0x8aa2d6, vertexColors: true, transparent: true, opacity: 0.04, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.linkObj.renderOrder = 2; this.linkObj.frustumCulled = false;
    this.scene.add(this.linkObj);
    // learned fibres in a warm tone, brighter the stronger they are
    const qp = new Float32Array(Math.max(1, llinks.length) * SEG * 2 * 3), qc = new Float32Array(qp.length);
    o = 0;
    for (const l of llinks) {
      const k = 0.25 + 0.75 * Math.min(1, l.w / 6);
      let px = l.a.x, py = l.a.y, pz = l.a.z;
      for (let sg = 1; sg <= SEG; sg++) {
        const t = sg / SEG, u = 1 - t;
        const x = u * u * l.a.x + 2 * u * t * l.c.x + t * t * l.b.x, y = u * u * l.a.y + 2 * u * t * l.c.y + t * t * l.b.y, z = u * u * l.a.z + 2 * u * t * l.c.z + t * t * l.b.z;
        for (let j = 0; j < 6; j++) qc[o + j] = k;
        qp[o++] = px; qp[o++] = py; qp[o++] = pz; qp[o++] = x; qp[o++] = y; qp[o++] = z;
        px = x; py = y; pz = z;
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(qp, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(qc, 3));
    lg.setDrawRange(0, llinks.length * SEG * 2);
    this.learnObj = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffbf73, vertexColors: true, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.learnObj.renderOrder = 2; this.learnObj.frustumCulled = false;
    this.scene.add(this.learnObj);
    const sp = this.makePoints(5000);
    this.spikeGeo = sp.g; this.spikeObj = new THREE.Points(sp.g, sp.mat); this.spikeObj.renderOrder = 4; this.spikeObj.frustumCulled = false;
    this.scene.add(this.spikeObj);

    // connections that weren't there at the last build light up as they form
    const fresh = this.learnedLinks ? [...learnedLinks.entries()].filter(([k2, l]) => l.learned && !this.learnedLinks.has(k2)).map(e => e[1]) : [];
    this.nodes = nodes; this.links = links; this.byPath = byPath;
    this.learnedLinks = learnedLinks;
    this.learnedCounts = { neurons: nLearned, synapses: nLearnedSyn };
    if (this.clipOn) for (const o of [this.linkObj, this.learnObj]) if (o) o.material.clippingPlanes = [this.clipPlane];
    if (this.plugin.settings.showNotes === false) for (const o of [this.nodeObj, this.linkObj, this.learnObj]) if (o) o.visible = false;
    for (const l of fresh.slice(0, 12)) { this.spark(l, l.a, '#ffcf8a'); this.spark(l, l.b, '#ffcf8a'); }
    this.hover = null; this.pings = [];   // spikes in flight keep travelling on the old curves
    this.needsDraw = true;
    this.counts = Object.fromEntries(LOBE_ORDER.map(k => [k, 0]));
    for (const n of nodes) if (!n.learned) this.counts[n.lobe]++;
    this.renderRegions();
  }

  /* ---------- camera ---------- */

  resize() {
    if (!this.renderer) return;
    const cw = this.contentEl.clientWidth, ch = this.contentEl.clientHeight;
    this.visible = cw > 0 && ch > 0;
    const w = Math.max(1, cw), h = Math.max(1, ch);
    this.needsDraw = true;
    this.cssW = w; this.cssH = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.floor(w * dpr); this.overlay.height = Math.floor(h * dpr);
    this.camera.aspect = w / h;
    // nudge the brain right of centre so the region list on the left doesn't collide with its labels
    let shift = 0;
    if (w > 900 && !this.mini && !this.plugin.settings.minimal) shift -= Math.round(Math.min(120, w * 0.06));
    if (w > 760 && this.panel && !this.mini) shift += Math.round((this.panelWidth() + 30) / 2);
    const lift = this.mini ? -Math.round(h * 0.16) : 0;    // mini: sit below the session list
    if (shift || lift) this.camera.setViewOffset(w, h, shift, lift, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const v = this.view;
    const fit = Math.max(1, 1.45 * (this.cssH / Math.max(1, this.cssW)) * 0.9);
    let d = v.dist * Math.max(1, fit);
    if (this.mini) {
      // narrow sidebar: fit the brain's width instead of its height
      const hf = Math.atan(Math.tan(15 * Math.PI / 180) * (this.cssW / Math.max(1, this.cssH)));
      d = Math.max(v.dist, 96 / Math.tan(hf)) * (v.dist / 300);
    }
    const cp = Math.cos(v.pitch);
    this.camera.position.set(Math.sin(v.yaw) * cp * d, Math.sin(v.pitch) * d, Math.cos(v.yaw) * cp * d);
    this.camera.lookAt(0, -6, 0);
    if (v.panX || v.panY) {
      this.camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      const k = d / 900;
      this.camera.position.addScaledVector(right, -v.panX * k).addScaledVector(up, v.panY * k);
    }
    this.camera.updateMatrixWorld();
    const L = new THREE.Vector3(-0.35, 0.85, -0.4);
    this.brainMat.uniforms.uLight.value.copy(L);
  }

  project(x, y, z, out) {
    const v = this._pv || (this._pv = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.cssW; out.y = (-v.y * 0.5 + 0.5) * this.cssH; out.z = v.z;
    return out;
  }

  // which region of the cortex is under the mouse (ray cast against the brain surface)
  pickLobe(sx, sy) {
    if (!this.brainMesh) return null;
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    rc.setFromCamera(new THREE.Vector2((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1), this.camera);
    const hit = rc.intersectObject(this.brainMesh, false)[0];
    if (!hit || !hit.face) return null;
    const k = LOBE_ORDER[Math.round(this.mesh.lobe[hit.face.a])];
    return k && k !== 'stem' ? k : null;
  }

  screenToNode(sx, sy) {
    if (this.plugin.settings.showNotes === false) return null;
    let best = null, bd = 10 * 10;
    for (const n of this.nodes) {
      if (this.dim.has(n.lobe)) continue;
      const d = (n.sx - sx) ** 2 + (n.sy - sy) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  bindInput() {
    const c = this.canvas;
    let drag = null, moved = false;
    this.registerDomEvent(c, 'wheel', (e) => {
      e.preventDefault();
      this.view.dist = Math.min(1200, Math.max(140, this.view.dist * Math.exp(e.deltaY * 0.0012)));
      this.lastInteract = performance.now();
    }, { passive: false });
    this.registerDomEvent(c, 'mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.view.yaw, pitch: this.view.pitch, px: this.view.panX, py: this.view.panY, pan: e.button === 1 || e.shiftKey };
      moved = false; c.addClass('cb-dragging');
    });
    this.registerDomEvent(window, 'mouseup', () => { drag = null; c.removeClass('cb-dragging'); });
    this.registerDomEvent(c, 'mousemove', (e) => {
      const r = c.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (drag.pan) { this.view.panX = drag.px + dx; this.view.panY = drag.py + dy; }
        else {
          this.view.yaw = drag.yaw - dx * 0.0065;
          this.view.pitch = Math.max(-1.3, Math.min(1.35, drag.pitch + dy * 0.0065));
        }
        this.lastInteract = performance.now();
      } else {
        const x = e.clientX - r.left, y = e.clientY - r.top;
        if ((this.frozen || (this.timeScale || 1) < 1) && !this.mini) {
          const h = this.pickSpike(x, y);
          if ((h && h.sp) !== (this.hoverSpike && this.hoverSpike.sp)) { this.hoverSpike = h; this.needsDraw = true; }
          if (h) { if (this.tipT) window.clearTimeout(this.tipT); this.showSpikeTip(h, x, y); c.addClass('cb-pointing'); return; }
          c.removeClass('cb-pointing');
          if (this.tipEl) this.tipEl.removeClass('is-rich');
        }
        this.hover = this.screenToNode(x, y);
        // name of the gyrus or nucleus under the mouse, checked a few times a second
        if (!this.mini) {
          if (this.tipT) window.clearTimeout(this.tipT);
          this.tipT = window.setTimeout(() => this.showTip(x, y), 110);
        }
      }
    });
    this.registerDomEvent(c, 'mouseleave', () => { this.hover = null; this.needsDraw = true; if (this.tipT) window.clearTimeout(this.tipT); if (this.tipEl) this.tipEl.removeClass('is-on'); });
    this.registerDomEvent(c, 'mousedown', () => { if (this.tipT) window.clearTimeout(this.tipT); if (this.tipEl) this.tipEl.removeClass('is-on'); });
    this.registerDomEvent(c, 'click', (e) => {
      if (moved) return;
      this.contentEl.focus({ preventScroll: true });
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (this.mini) { this.plugin.activateView(); return; }
      if (this.frozen || (this.timeScale || 1) < 1) {
        const h = this.pickSpike(x, y);
        if (h) { if (!this.frozen) this.setTimeScale(0); this.selSpike = h; this.needsDraw = true; this.openPanel({ kind: 'signal', h }); return; }
      }
      const n = this.screenToNode(x, y);
      if (n && !n.learned) { this.app.workspace.openLinkText(n.path, '', true); return; }
      if (n && n.learned) { this.openPanel({ kind: 'region', id: n.lobe }); this.flash(n.proj + '/' + n.file); return; }
      const b = this.labelBlocks.find(q => x >= q.x - 4 && x <= q.x + q.w + 4 && y >= q.top - 2 && y <= q.top + q.h);
      if (b) { this.togglePanel({ kind: 'region', id: b.k }); return; }
      const hit = this.pickAnatomy(x, y);
      if (hit && hit.kind === 'inner') { this.togglePanel({ kind: 'inner', id: hit.name, side: hit.side }); return; }
      if (hit && hit.kind === 'cortex' && hit.lobe && hit.lobe !== 'stem') this.togglePanel({ kind: 'region', id: hit.lobe, aal: hit.label });
    });
    const reset = () => this.resetCamera();
    this.registerDomEvent(c, 'dblclick', reset);
    this.registerDomEvent(c, 'contextmenu', (e) => { e.preventDefault(); reset(); });
  }

  /* ---------- activity ---------- */

  pulse(pos, hex, amp, sigma, life, rise) {
    amp *= this._k == null ? 1 : this._k;
    if (amp < 0.01 || !pos) return;
    this.pulses.push({ x: pos.x, y: pos.y, z: pos.z, c: col3(hex), amp, sigma, t: 0, life: life || 2.2, rise: rise || 0.18 });
    if (this.pulses.length > 60) this.pulses.shift();
    this.eegFeed(pos, amp);
  }

  wave(origin, hex, amp) {
    if (!origin || (this._k != null && this._k < 1)) return;
    this.waves.push({ x: origin.x, y: origin.y, z: origin.z, c: col3(hex), amp: amp || 0.9, r: 0 });
    if (this.waves.length > MAXW) this.waves.shift();
  }

  // hex colours the note itself (what); shex colours the spikes it sends out (who)
  fire(n, hex, str, depth, from, shex, src) {
    if (!n || str < 0.02) return;
    if (n.hub && depth > 0) str = Math.min(str, 0.32);   // everything links to hubs: keep the centre from flaring
    n.act = Math.min(1.2, Math.max(n.act, str));
    n.actColor = col3(hex);
    n.firedAt = Date.now();
    if (depth === 0) this.pulse(n, hex, 0.75 * Math.min(1, str), 9, 2.2);
    if (depth < 2 && str > 0.3 && n.adj.length) {
      const sh = shex || hex, sc = col3(sh);
      const pool = from ? n.adj.filter(e => e.n !== from) : n.adj;
      for (const e of shuffled(pool, depth === 0 ? 4 : 1)) {
        if (this.spikes.length > 480) break;
        this.spikes.push({ a: n, b: e.n, l: e.l, t: 0, speed: 0.6 + Math.random() * 0.5, hex: sh, c: sc, str: str * 0.55, depth: depth + 1, src: src || this._src || null });
      }
    }
  }

  // send one spike along a specific link (a learned connection being used)
  spark(l, from, hex) {
    if (!l || this.spikes.length > 480) return;
    const a = from === l.b ? l.b : l.a, b = a === l.a ? l.b : l.a;
    this.spikes.push({ a, b, l, t: 0, speed: 0.7, hex, c: col3(hex), str: 0.5, depth: 1 });
  }

  ping(n, hex) {
    n.labelT = 3.2; this.pings.push({ n, t: 0, c: col3(hex || '#ffffff') });
    this.labeled = (this.labeled || []).filter(x => x !== n).concat([n]);
    while (this.labeled.length > 3) this.labeled.shift().labelT = 0;   // at most 3 labels at once
  }

  lobeBurst(lobe, hex, amp, count, shex) {
    const k = this._k == null ? 1 : this._k, src = this._src;
    for (const s of ['L', 'R']) {
      const r = this.regions[lobe + s];
      if (r) this.pulse(r.surf || r, hex, Math.min(lobe === 'thalamus' ? 0.25 : 0.5, amp * 0.6), lobe === 'thalamus' ? 8 : 15, 2.6);
    }
    shuffled(this.nodes.filter(n => n.lobe === lobe && !n.learned), count).forEach((n, i) => window.setTimeout(() => this.fire(n, hex, amp * k, 1, null, shex, src), i * 70));
  }

  attend(lobe, amt) {
    if (!lobe || lobe === 'thalamus' || lobe === 'stem') return;
    if (this._k != null && this._k < 1) return;
    this.attn[lobe] = (this.attn[lobe] || 0) + amt;
  }

  addTag(lobe, s, text, a) {
    if (!lobe || lobe === 'thalamus' || lobe === 'stem') return;
    if (this._k != null && this._k < 1) return;
    const key = s.id + (a ? '/' + a.id : '');
    this.tags = this.tags.filter(t => !(t.lobe === lobe && t.sid === key));
    this.tags.push({ lobe, sid: key, color: s.color, proj: this.plugin.agentLabel(s, a), text, t: 0, sub: !!a });
    if (this.tags.length > 24) this.tags.shift();
  }

  // the learned neuron for a file outside the vault, plus the connection it just used or formed
  learnedTargets(ev, s, learnt, sc) {
    const out = [];
    const L = learnt || (ev.hook_event_name === 'PreToolUse' ? this.plugin.learnKey(s, ev) : null);
    if (!L) return out;
    const node = L.key.startsWith('n:') ? this.byPath.get(L.key.slice(2)) : this.byPath.get(L.key);
    if (node && node.learned) out.push(node);
    if (learnt && learnt.syn) {
      const l = this.learnedLinks && this.learnedLinks.get(learnt.syn.a + '|' + learnt.syn.b);
      if (l) window.setTimeout(() => this.spark(l, node, sc), 120);
      this.innerAct('Hippocampus', '#c9b8ff', learnt.syn.isNew ? 0.9 : 0.5);
    }
    return out;
  }

  // a subagent or workflow agent did something: the same pathways as the main session, quieter, relayed through the parietal "agents" area
  onAgentBrainEvent(ev, s, a, opts, learnt, strikes) {
    const e = ev.hook_event_name;
    const cat = evCat(ev);
    const lobe = (CAT[cat] || CAT.other).lobe;
    const sc = s.color || SIGNAL;
    const k = this._k == null ? 1 : this._k;
    const relay = (amp) => {
      const r = this.regions[(s.idx & 1) ? 'parietalR' : 'parietalL'];
      if (r && r.anchors) this.pulse(r.anchors[((a.tools || 0) + 1) % r.anchors.length], sc, amp, 11, 1.6);
    };
    switch (e) {
      case 'SubagentStart': relay(0.35); this.attend('parietal', 0.5); this.signalNear('agent', this.regions.parietalR || THALAMUS, sc, 0.8 * k); break;
      case 'PreToolUse': {
        const hex = catColor(cat);
        const targets = this.resolveTargets(ev).slice(0, 3).concat(this.learnedTargets(ev, s, learnt, sc));
        { const src = this._src; targets.forEach((n, i) => window.setTimeout(() => { this.fire(n, hex, 0.9 * k, 0, null, sc, src); if (k === 1) this.ping(n, sc); }, i * 90)); }
        strikes.forEach((st, i) => this.strike(st, sc, 0.75 * k, i * 110, { amp: 0.5 }));
        if (!strikes.length) this.lobeBurst(lobe, hex, 0.45, 2, sc);
        this.tractSignal('parietal', lobe, sc, 1);
        relay(0.16);
        if (cat !== 'plan') this.addTag(lobe, s, (opts && opts.text) || describe(ev), a);
        this.attend(lobe, 0.6);
        break;
      }
      case 'PostToolUse': strikes.forEach((st, i) => this.strikeBack(st, sc, 0.7 * k, i * 80)); break;
      case 'PostToolUseFailure':
        strikes.forEach((st, i) => { const g = this.gyrusAnchor[st.label]; if (g) this.pulse(g, ERR, 0.35 * k, 9, 1.6); });
        this.innerAct('Amygdala', ERR, 0.6);
        break;
      case 'SubagentStop': this.lobeBurst('parietal', LOBES.parietal.color, 0.55, 2, sc); this.signalNear('agent', this.regions.parietalR || THALAMUS, sc, 0.8 * k, null, true); break;
      default: strikes.forEach((st, i) => this.strike(st, sc, 0.7 * k, i * 110, { amp: 0.45 })); break;
    }
  }

  hubs() { return this.nodes.filter(n => n.hub); }

  resolveTargets(ev) {
    const ti = ev.tool_input || {};
    const out = [];
    for (const p of [ti.file_path, ti.notebook_path, ti.path]) {
      const rel = this.plugin.toVaultRel(p, ev.cwd);
      if (rel === null) continue;
      const exact = this.byPath.get(rel) || this.byPath.get(rel + '.md');
      if (exact) { out.push(exact); continue; }
      const dir = rel === '' ? '' : rel + '/';
      let inDir = this.nodes.filter(n => !n.learned && n.path.startsWith(dir));
      if (!inDir.length) {
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
        inDir = this.nodes.filter(n => !n.learned && n.path.startsWith(parent) && !n.path.slice(parent.length).includes('/'));
      }
      out.push(...shuffled(inDir, 5));
    }
    return out;
  }

  // opts: { replay: true, t, text } when the timeline replays a recorded event
  onBrainEvent(ev, s, a, opts, rec, learnt) {
    if (!this.scene) return;
    const replay = !!(opts && opts.replay);
    if (this.replay && !replay) return;            // while replaying, live events are recorded but not drawn
    s = s || { id: 'unknown', color: SIGNAL, project: '', idx: 0 };
    this.lastActivity = performance.now();
    if (!replay && this.dream) this.stopDream();
    if (this.frozen && !replay) { this.missed = (this.missed || 0) + 1; this.pushLog(ev, evCat(ev), s, a, opts); return; }
    this._k = this.focusSid && s.id !== this.focusSid ? 0.18 : 1;
    const strikes = (rec && rec.strikes) || [];
    this._src = { type: opts && opts.replay ? 'replay' : 'event', rec, sid: s.id, color: s.color, agent: a ? a.type : '' };
    try {
      if (a) { this.onAgentBrainEvent(ev, s, a, opts, learnt, strikes); this.pushLog(ev, evCat(ev), s, a, opts); return; }
      this.mainBrainEvent(ev, s, opts, learnt, strikes, rec);
      this.pushLog(ev, evCat(ev), s, null, opts);
    } finally { this._k = null; this._src = null; }
  }

  mainBrainEvent(ev, s, opts, learnt, strikes, rec) {
    const e = ev.hook_event_name;
    const cat = evCat(ev);
    const lobe = (CAT[cat] || CAT.other).lobe;
    const sc = s.color || SIGNAL;
    const k = this._k == null ? 1 : this._k;
    const thal = { x: 0, y: THALAMUS.y, z: THALAMUS.z };
    const play = (o, gap) => strikes.forEach((st, i) => this.strike(st, sc, k, i * (gap || 110), o));
    switch (e) {
      case 'SessionStart': case 'Setup':
        // waking up: the reticular activating system, brain stem to thalamus
        this.pulse(STEM, SIGNAL, 0.4, 10, 2.5);
        for (let i = 0; i < 4; i++) this.signalUp('arouse', '#cfe0ff', k, i ? null : () => { this.wave(thal, '#8fb4ff', 0.22); this.innerAct('Thalamus', '#dfe8ff', 0.5); }, false, 110 + i * 15);
        break;
      case 'SessionEnd': this.wave(thal, '#8b93a1', 0.3); this.pulse(STEM, '#8b93a1', 0.3, 10, 2); for (let i = 0; i < 2; i++) this.signalUp('arouse', '#8b93a1', 0.6 * k, null, true, 90); break;
      case 'UserPromptSubmit': case 'UserPromptExpansion':
        // hearing you: auditory radiation into Heschl's gyrus, then Wernicke's area, then the thalamus wakes the rest
        this.pulse(thal, sc, 0.26, 8, 1.8);
        play({ amp: 0.45, onArrive: () => this.wave(thal, '#8fb4ff', 0.24) });
        this.innerAct('Thalamus', '#dfe8ff', 0.6);
        this.relaySignal(sc, 4);
        if (e === 'UserPromptExpansion') this.innerAct('Caudate nucleus', sc, 0.6);     // a stored procedure: the striatum
        { const src = this._src; shuffled(this.hubs(), 3).forEach((n, i) => window.setTimeout(() => this.fire(n, SIGNAL, 0.5 * k, 1, null, sc, src), 150 + i * 60)); }
        this.attend('frontal', 0.6);
        break;
      case 'PreToolUse': {
        const hex = catColor(cat);
        const targets = this.resolveTargets(ev).concat(this.learnedTargets(ev, s, learnt, sc));
        { const src = this._src; targets.forEach((n, i) => window.setTimeout(() => { this.fire(n, hex, 1.15 * k, 0, null, sc, src); if (k === 1) this.ping(n, sc); }, i * 90)); }
        // the thalamus dispatches, then every command of the call travels to where that kind of work happens
        this.pulse(THALAMUS, sc, 0.14 * k, 7, 1.2);
        this.innerAct('Thalamus', '#dfe8ff', 0.25);
        play({ amp: 0.62 });
        if (!strikes.length) { this.lobeBurst(lobe, hex, 0.55, 3, sc); this.innerFor(cat, hex); }
        else if (targets.length) this.lobeBurst(lobe, hex, 0.3, 1, sc);
        if (this.lastLobe[s.id] && this.lastLobe[s.id] !== lobe) this.tractSignal(this.lastLobe[s.id], lobe, sc, 2);
        this.lastLobe[s.id] = lobe;
        if (cat === 'agent' && this.regions.parietalR) this.wave(this.regions.parietalR.surf, hex, ev.tool_name === 'Workflow' ? 0.5 : 0.4);
        if (cat !== 'plan') { this.addTag(lobe, s, (opts && opts.text) || describe(ev)); this.attend(lobe, 1); }
        break;
      }
      case 'PostToolUse': {
        const n = rec && rec.size || 0;
        strikes.forEach((st, i) => this.strikeBack(st, sc, k, i * 80, n > 4000 ? 2 : n > 400 ? 1 : 0));
        if (!strikes.length) this.lobeBurst(lobe, catColor(cat), 0.3, 1, sc);
        break;
      }
      case 'PostToolUseFailure': case 'PermissionDenied': case 'StopFailure': {
        const pre = (rec && rec.pre) || [];
        pre.forEach((st) => { const g = this.gyrusAnchor[st.label]; if (g) this.pulse(g, ERR, 0.38 * k, 10, 1.8); });
        play({ amp: 0.5, spikeHex: ERR });
        this.innerAct('Amygdala', ERR, 0.85);
        if (e === 'StopFailure') { this.wave(thal, ERR, 0.3); this.pulse(STEM, ERR, 0.3, 10, 2); }
        break;
      }
      case 'PostToolBatch':
        // the results of a parallel batch come together before the next step: a short thalamic binding burst
        this.pulse(THALAMUS, '#e6eeff', 0.22 * k, 8, 1.2); this.pulse({ x: -THALAMUS.x, y: THALAMUS.y, z: THALAMUS.z }, '#e6eeff', 0.22 * k, 8, 1.2);
        this.relaySignal('#e6eeff', 2);
        break;
      case 'SubagentStop': this.lobeBurst('parietal', LOBES.parietal.color, 0.7, 3, sc); this.attend('parietal', 0.5); break;
      case 'PreCompact': case 'PostCompact':
        // compaction is consolidation: hippocampal ripples replay into the cortex
        this.wave(thal, '#c9d1dc', e === 'PreCompact' ? 0.5 : 0.3);
        play({ amp: 0.45 }, 160);
        for (let i = 0; i < 4; i++) window.setTimeout(() => this.signalNear('memory', this.gyrusAnchor[this.plugin.labelFor('memory', i)] || THALAMUS, '#c9b8ff', k, null, i % 2 === 1), i * 140);
        this.innerAct('Hippocampus', '#c9b8ff', 0.8);
        break;
      case 'Notification':
        if (s.wait && s.wait.kind === 'approval') { this.lobeBurst('frontal', WAIT, 0.7, 2, WAIT); this.attend('frontal', 1.5); this.innerAct('Amygdala', WAIT, 0.9); }
        else if (s.wait && s.wait.kind === 'input') { const g = this.gyrusFor('alarm', s.id); if (g) this.pulse(g, '#8fb4ff', 0.2, 10, 2); }
        break;
      case 'PermissionRequest': case 'Elicitation':
        play({ amp: 0.6, spikeHex: WAIT });
        this.innerAct('Amygdala', WAIT, 0.9); this.attend('frontal', 1.5);
        break;
      case 'TaskCompleted':
        // a task done: a small reward signal from the midbrain into the striatum and orbitofrontal cortex
        play({ amp: 0.55, spikeHex: GOLD });
        this.signalNear('reward', THALAMUS, GOLD, k, () => { this.innerAct('Caudate nucleus', GOLD, 0.8); this.innerAct('Putamen', GOLD, 0.5); });
        break;
      case 'Stop':
        this.pulse(thal, sc, 0.3, 12, 2); this.innerAct('Thalamus', sc, 0.45); this.lastLobe[s.id] = null;
        // end of a turn: the hippocampus takes in what happened
        this.signalNear('memory', this.gyrusAnchor[this.plugin.labelFor('memory', s.id)] || THALAMUS, '#c9b8ff', k, () => this.innerAct('Hippocampus', '#c9b8ff', 0.55));
        break;
      case 'PreModelSwitch': case 'PostModelSwitch': this.wave(thal, '#c9d1dc', 0.45); break;
      default: play({ amp: 0.5 }); break;   // instructions loaded, task created, folder or worktree changes, files changed, config, elicitation answers
    }
  }

  // Claude writing its reply: language output through the arcuate fasciculus into Broca's area (left inferior frontal gyrus)
  onSpeech(s, n, strikes) {
    if (!this.scene || this.replay) return;
    if (this.focusSid && s.id !== this.focusSid) return;
    const now = performance.now();
    this.lastActivity = now;
    s._spk = (s._spk || 0) + n;
    if (now - (s._spkT || 0) < 90) return;           // several chunks per frame make one signal
    const amt = Math.min(1, 0.25 + Math.log10(1 + s._spk) * 0.25);
    s._spkT = now; s._spk = 0;
    for (const st of strikes) this.strike(st, s.color || SIGNAL, amt, 0, { amp: 0.42, sigma: 8, life: 1.4, nucleus: false, speed: 150 });
    this.attend('frontal', 0.15);
  }

  pushLog(ev, cat, s, a, opts) {
    const e = ev.hook_event_name;
    const names = {
      SessionStart: ['SESSION', 'Session started'], UserPromptSubmit: ['PROMPT', 'New prompt'], Stop: ['DONE', 'Finished, your turn'],
      SubagentStop: ['AGENT', 'Subagent finished'], PreCompact: ['COMPACT', 'Compacting context'], PostCompact: ['COMPACT', 'Context compacted'],
      SessionEnd: ['END', 'Session ended'], Message: ['REPLY', 'Wrote'], UserPromptExpansion: ['PROMPT', 'Command'],
      InstructionsLoaded: ['RECALL', 'Instructions'], TaskCreated: ['PLAN', 'New task:'], TaskCompleted: ['DONE', 'Task done:'],
      CwdChanged: ['MOVE', 'Now in'], DirectoryAdded: ['MOVE', 'Added folder'], ConfigChange: ['CONFIG', 'Settings changed:'],
      PreModelSwitch: ['MODEL', 'Switching to'], PostModelSwitch: ['MODEL', 'Now using'], ElicitationResult: ['ANSWER', 'You answered'],
      PostToolBatch: ['BATCH', 'Parallel tools:'], TeammateIdle: ['AGENT', 'Teammate idle'], Setup: ['SETUP', 'Setup'],
      PermissionDenied: ['DENIED', ''], StopFailure: ['ERROR', 'Stopped:'],
    };
    const ncol = { PermissionDenied: ERR, StopFailure: ERR, TaskCompleted: GOLD, Message: KIND_HEX.speak, InstructionsLoaded: KIND_HEX.memory, TaskCreated: LOBES.frontal.color };
    let tag, text, color, region = '';
    if (a && e === 'SubagentStart') { tag = 'AGENT'; color = LOBES.parietal.color; text = 'Started' + (a.desc ? ': ' + a.desc : a.wf ? ' as a workflow agent' : ''); }
    else if (a && e === 'SubagentStop') { tag = 'AGENT'; color = LOBES.parietal.color; text = 'Finished' + (a.tools ? ` after ${a.tools} tool call${a.tools > 1 ? 's' : ''}` : ''); }
    else if (e === 'PostToolUseFailure') { tag = 'FAIL'; color = '#ff6b6b'; text = toolLabel(ev.tool_name) + ' failed'; }
    else if (e === 'PreToolUse') {
      const c = CAT[cat] || CAT.other;
      tag = c.tag; color = catColor(cat);
      region = cat === 'plan' ? '' : LOBES[c.lobe].label.toLowerCase();
      if (opts && opts.text) text = opts.text;
      else {
        const t = targetOf(ev, this.plugin);
        text = cat === 'plan' ? describe(ev) : /^(Bash|PowerShell)$/.test(ev.tool_name) ? (t || 'Shell command') : toolLabel(ev.tool_name) + (t ? ' ' + t : '');
      }
    } else if (e === 'Notification' || e === 'PermissionRequest' || e === 'Elicitation') {
      if (!s || !s.wait) return;
      tag = 'WAIT'; color = WAIT;
      text = s.wait.kind === 'approval' ? clip(s.wait.msg || ev.message || 'Needs your approval', 80) : 'Waiting for your reply';
    } else if (names[e]) {
      [tag, text] = names[e]; color = ncol[e] || '#8b93a1';
      const extra = (opts && opts.text) || eventText(ev);
      if (extra) text = (text ? text + ' ' : '') + extra;
      if (!text) return;
    }
    else return;
    if (this.focusSid && s && s.id !== this.focusSid) return;
    const many = this.plugin.sessions.size > 1 || (s && !this.plugin.isLocal(ev));
    const proj = a ? this.plugin.agentLabel(s, a) : many ? (s && (s.label || s.project)) || baseName(ev.cwd) : '';
    const ti = ev.tool_input || {};
    const rel = e === 'PreToolUse' ? this.plugin.toVaultRel(ti.file_path || ti.notebook_path, ev.cwd) : null;
    const file = rel && this.byPath.get(rel) && !this.byPath.get(rel).learned ? rel : null;
    this.log.unshift({ t: (opts && opts.t) || Date.now(), replay: !!(opts && opts.replay), tag, text, region, color, proj, pcolor: (s && s.color) || '#8b93a1', file, abs: ti.file_path || '' });
    this.log = this.log.slice(0, 6);
    this.logDirty = true;
    this.requestHud();
  }

  requestHud() {
    if (this.hudTimer) return;
    this.hudTimer = window.setTimeout(() => {
      this.hudTimer = null;
      this.renderHud();
      if (this.logDirty) { this.logDirty = false; this.renderLog(); }
      if (this.panel) this.renderPanel();
      this.drawTimeline();
    }, 180);
  }

  /* ---------- layout, keys, panels ---------- */

  applyLayout() {
    const root = this.contentEl, st = this.plugin.settings;
    const on = (k) => !this.mini && !st.minimal && !!st[k];
    root.toggleClass('cb-min', !this.mini && !!st.minimal);
    root.toggleClass('cb-show-sessions', this.mini || (!st.minimal && st.showSessions !== false));
    root.toggleClass('cb-sessions-closed', !this.mini && st.sessionsOpen === false);
    root.toggleClass('cb-show-activity', on('showActivity'));
    root.toggleClass('cb-has-tl', on('showTimeline') || !!this.replay);
    root.toggleClass('cb-show-regions', on('showRegions'));
    root.toggleClass('cb-show-eeg', on('showEeg'));
    root.toggleClass('cb-has-panel', !this.mini && !!this.panel);
    root.toggleClass('cb-panel-wide', !this.mini && !!this.panel && this.panel.kind === 'signal');
    root.toggleClass('cb-replaying', !!this.replay);
    if (this.dockBtns) for (const k of ['showSessions', 'showActivity', 'showTimeline', 'showRegions', 'showEeg']) if (this.dockBtns[k]) this.dockBtns[k].toggleClass('is-on', !!st[k]);
    if (this.chevEl) this.chevEl.setText(st.sessionsOpen === false ? '›' : '⌄');
    this.resize();
    this.drawTimeline(true);
  }

  toggleUi(key) {
    const st = this.plugin.settings;
    st[key] = !st[key];
    if (st.minimal) st.minimal = false;
    this.plugin.saveAll();
    this.applyLayout();
    if (key === 'showRegions') this.renderRegions();
  }

  setLook(v, say) {
    this.plugin.settings.look = v === 'atlas' ? 'atlas' : 'anatomy';
    this.plugin.saveAll();
    this.plugin.forEachView(w => { w.needsDraw = true; if (w.renderLookUi) w.renderLookUi(); });
    if (say) this.flash(v === 'atlas' ? 'Atlas look: see-through brain' : 'Anatomy look');
  }
  renderLookUi() { for (const [v, b] of this.lookBtns || []) b.toggleClass('is-on', (this.plugin.settings.look || 'anatomy') === v); }
  togglePop(which, force) {
    const el = which === 'layers' ? this.layersEl : this.sliceEl;
    if (!el) return;
    const on = force === undefined ? !el.classList.contains('is-on') : force;
    if (on) { this.toggleInfo(false); if (which === 'layers') this.sliceEl.removeClass('is-on'); else this.layersEl.removeClass('is-on'); }
    el.toggleClass('is-on', on);
    if (this.dockBtns && this.dockBtns[which]) this.dockBtns[which].toggleClass('is-on', on || (which === 'slice' && !!this.plugin.settings.sliceOn));
  }

  toggleSlice(force) {
    if (!this.slice) { this.flash('The MRI volume (t1.bin.gz) is missing from the plugin folder'); return; }
    const st = this.plugin.settings;
    st.sliceOn = force === undefined ? !st.sliceOn : force;
    this.plugin.saveAll();
    this.applyAnatomy();
    this.togglePop('slice', !!st.sliceOn);
    this.renderSliceUi();
  }

  renderSliceUi() {
    if (!this.sliceEl) return;
    const st = this.plugin.settings;
    for (const b of this.axisBtns) b.toggleClass('is-on', b.dataset.ax === (st.sliceAxis || 'x'));
    this.sliceRange.value = String(Math.round((st.slicePos == null ? 0.5 : st.slicePos) * 1000));
    this.cutBox.checked = st.sliceCut !== false;
    const v = this.sliceAt || 0, ax = st.sliceAxis || 'x';
    // scene coordinates back to MNI millimetres, the way radiologists read them
    const mni = ax === 'x' ? `x = ${v.toFixed(0)} mm` : ax === 'z' ? `y = ${(-(v) - 15).toFixed(0)} mm` : `z = ${(v + 10).toFixed(0)} mm`;
    this.sliceVal.setText(mni);
    if (this.dockBtns) this.dockBtns.slice.toggleClass('is-on', !!st.sliceOn);
  }

  toggleInfo(force) {
    if (!this.infoEl) return;
    const on = force === undefined ? !this.infoEl.classList.contains('is-on') : force;
    this.infoEl.toggleClass('is-on', on);
    if (this.dockBtns) this.dockBtns.info.toggleClass('is-on', on);
    if (on) { this.renderHud(); if (this.layersEl) this.layersEl.removeClass('is-on'); if (this.dockBtns && this.dockBtns.layers) this.dockBtns.layers.removeClass('is-on'); }
  }

  // the dock fades while nobody touches the view, and comes back on any mouse movement
  wake() {
    if (!this.dockEl) return;
    this.contentEl.removeClass('cb-idle');
    if (this.idleT) window.clearTimeout(this.idleT);
    this.idleT = window.setTimeout(() => this.contentEl.addClass('cb-idle'), 2600);
  }

  flash(msg) {
    if (!this.flashEl) this.flashEl = this.contentEl.createDiv({ cls: 'cb-flash' });
    this.flashEl.setText(msg);
    this.flashEl.addClass('is-on');
    if (this.flashT) window.clearTimeout(this.flashT);
    this.flashT = window.setTimeout(() => this.flashEl && this.flashEl.removeClass('is-on'), 1400);
  }

  resetCamera() { Object.assign(this.view, { yaw: -1.15, pitch: 0.22, dist: this.mini ? 300 : 430, panX: 0, panY: 0 }); this.lastInteract = -1e9; this.needsDraw = true; }

  toggleMinimal() {
    this.plugin.settings.minimal = !this.plugin.settings.minimal;
    this.plugin.saveAll();
    this.applyLayout();
    this.flash(this.plugin.settings.minimal ? 'Everything hidden. Press H to bring it back' : 'Back');
  }

  bindKeys() {
    this.registerDomEvent(this.contentEl, 'keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      let used = true;
      if (this.mini) used = false;
      else if (k === 'h') this.toggleMinimal();
      else if (k === 's') this.toggleUi('showSessions');
      else if (k === 'a') this.toggleUi('showActivity');
      else if (k === 'g') this.toggleUi('showRegions');
      else if (k === 'e') this.toggleUi('showEeg');
      else if (k === 'i') this.toggleInfo();
      else if (k === 'l') this.togglePop('layers');
      else if (k === 'm') this.toggleSlice();
      else if (k === 'v') this.setLook(this.plugin.settings.look === 'atlas' ? 'anatomy' : 'atlas', true);
      else if (k === ' ') { if (this.frozen) this.setTimeScale(this.timeScale && this.timeScale < 1 ? this.timeScale : 1); else this.setTimeScale(0); }
      else if (k === ',' || k === '.') this.setTimeScale(k === ',' ? ((this.timeScale || 1) <= 0.1 ? 0.1 : (this.timeScale || 1) <= 0.25 ? 0.1 : 0.25) : ((this.timeScale || 1) >= 0.25 ? 1 : 0.25));
      else if (k === 'f') { this.plugin.settings.follow = !this.plugin.settings.follow; this.plugin.saveAll(); this.flash(this.plugin.settings.follow ? 'Following activity' : 'Not following activity'); }
      else if (k === 't') this.toggleUi('showTimeline');
      else if (k === 'r') { this.resetCamera(); this.flash('View reset'); }
      else if (k === 'Escape') { if (this.infoEl && this.infoEl.classList.contains('is-on')) this.toggleInfo(false); else if (this.replay) this.stopReplay(); else if (this.panel) this.closePanel(); else if (this.focusSid) this.toggleFocus(this.focusSid); else used = false; }
      else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    });
  }

  toggleFreeze(force) {
    const on = force === undefined ? !this.frozen : !!force;
    if (on === !!this.frozen) return;
    this.frozen = on;
    this.contentEl.toggleClass('cb-is-frozen', on);
    if (this.dockBtns && this.dockBtns.freeze) { this.dockBtns.freeze.toggleClass('is-on', on); try { setIcon(this.dockBtns.freeze, on ? 'play' : 'pause'); } catch (e) { /* */ } }
    if (on) {
      this.missed = 0;
      this.renderFrozenHint();
    } else {
      this.hoverSpike = null; this.selSpike = null;
      if (this.tipEl) this.tipEl.removeClass('is-on');
      if (this.missed) this.flash(`${this.missed} event${this.missed === 1 ? '' : 's'} came in while frozen; they are in the activity list`);
    }
    this.needsDraw = true;
  }

  renderFrozenHint() {
    const el = this.frozenEl; if (!el) return;
    el.empty();
    const n = (this.tractSpikes || []).length + this.spikes.length;
    el.createSpan({ cls: 'cb-fz-t', text: this.frozen ? (n ? `Frozen · ${n} signal${n === 1 ? '' : 's'} in flight. Point at one to see what it carries, click it for everything about it.` : 'Frozen · nothing is travelling right now.') : 'Slow motion · point at a signal, click to stop and open it.' });
    const seg = el.createDiv({ cls: 'cb-seg' });
    for (const [v, l] of [[0, 'Stop'], [0.1, '0.1×'], [0.25, '0.25×'], [1, 'Live']]) {
      const b = seg.createEl('button', { cls: 'cb-tl-btn' + ((v === 0 ? this.frozen : !this.frozen && (this.timeScale || 1) === v) ? ' is-on' : ''), text: l });
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setTimeScale(v); });
    }
  }
  // 0 = frozen, 0.1 / 0.25 = slow motion (signals can still be pointed at), 1 = live
  setTimeScale(v) {
    if (v === 0) { this.timeScale = this.timeScale || 1; this.toggleFreeze(true); this.renderFrozenHint(); return; }
    this.timeScale = v;
    if (this.frozen) this.toggleFreeze(false);
    this.contentEl.toggleClass('cb-is-slow', v < 1);
    this.renderFrozenHint();
    this.needsDraw = true;
  }

  // the head of every spike in flight, in scene coordinates
  spikeHeads() {
    const out = [], tp = { x: 0, y: 0, z: 0 };
    for (const sp of this.tractSpikes || []) { this.tractPoint(sp.l, sp.fwd ? sp.t : 1 - sp.t, tp); out.push({ sp, kind: 'tract', x: tp.x, y: tp.y, z: tp.z }); }
    for (const sp of this.plugin.settings.showNotes === false ? [] : this.spikes) {
      const l = sp.l, fwd = l.a === sp.a, A = fwd ? l.a : l.b, B = fwd ? l.b : l.a, t = sp.t, u = 1 - t;
      out.push({ sp, kind: 'note', x: u * u * A.x + 2 * u * t * l.c.x + t * t * B.x, y: u * u * A.y + 2 * u * t * l.c.y + t * t * B.y, z: u * u * A.z + 2 * u * t * l.c.z + t * t * B.z });
    }
    return out;
  }
  pickSpike(sx, sy) {
    let best = null, bd = 14 * 14;
    const o = { x: 0, y: 0, z: 0 };
    for (const h of this.spikeHeads()) {
      this.project(h.x, h.y, h.z, o);
      if (o.z > 1) continue;
      const d = (o.x - sx) ** 2 + (o.y - sy) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  // a few words on what a spike carries
  describeSpike(h) {
    const sp = h.sp, src = sp.src || {}, P = this.plugin;
    const s = src.sid ? P.sessions.get(src.sid) : null;
    const who = s ? P.sessionLabel(s) : (src.rec && src.rec.label) || '';
    const st = src.st, r = src.rec;
    let tag = '', what = '', where = '', color = src.color || (s && s.color) || SIGNAL;
    if (h.kind === 'note') {
      tag = 'NOTE'; what = `${sp.a.name} → ${sp.b.name}`;
      where = r ? `set off by ${r.text || r.e}` : 'spreading through your notes';
    } else if (src.type === 'think') { tag = 'THINKING'; what = 'prefrontal loop'; where = 'the model is deliberating'; }
    else if (src.type === 'body') { tag = 'BODY'; what = { cpu: 'CPU load', net: 'network traffic', disk: 'disk traffic' }[src.what] || 'system'; where = src.machine === 'local' ? 'this computer' : src.machine || ''; color = VITAL; }
    else if (src.type === 'compact') { tag = 'MEMORY'; what = 'compacting context'; where = 'hippocampal replay'; }
    else if (src.type === 'workflow') { tag = 'AGENTS'; what = 'workflow running'; where = 'parietal network'; }
    else if (src.type === 'dream') { tag = 'DREAM'; what = `${KIND_TAG[st && st.kind] || ''} ${st && st.what ? st.what : ''}`.trim() || 'replay'; where = `replaying ${hhmm(src.t)}`; color = DREAM; }
    else {
      const e = r ? r.e : '';
      tag = st ? (KIND_TAG[st.kind] || st.kind).toUpperCase() : src.relay ? 'RELAY' : ({ UserPromptSubmit: 'PROMPT', Stop: 'DONE', SessionStart: 'WAKE', SubagentStart: 'AGENT', SubagentStop: 'AGENT' }[e] || 'SIGNAL');
      what = (st && st.what) || (r && r.text) || ({ UserPromptSubmit: 'your prompt', Stop: 'turn finished', SessionStart: 'session started', PostToolBatch: 'results together' }[e]) || e;
      if (src.type === 'running') where = 'still running';
      else if (sp.back) where = 'result going back';
      else if (st) where = 'on its way';
      if (src.type === 'replay') where = 'timeline replay';
    }
    const target = st ? aalName(st.label) : '';
    const fibre = h.kind === 'tract' ? bundleName(sp.l.bundle) : '';
    return { tag, what, who, color, where, target, fibre, agent: src.agent || '' };
  }
  showSpikeTip(h, sx, sy) {
    if (!this.tipEl) this.tipEl = this.contentEl.createDiv({ cls: 'cb-tip' });
    const d = this.describeSpike(h);
    this.tipEl.empty(); this.tipEl.addClass('is-rich');
    const l1 = this.tipEl.createDiv({ cls: 'cb-tip-1' });
    const tg = l1.createSpan({ cls: 'cb-tip-tag', text: d.tag }); tg.style.color = d.color;
    l1.createSpan({ text: ' ' + clip(d.what, 60) });
    const l2 = this.tipEl.createDiv({ cls: 'cb-tip-2' });
    if (d.who) { const w = l2.createSpan({ cls: 'cb-tip-who', text: d.who + (d.agent ? ' › ' + d.agent : '') }); w.style.color = d.color; }
    l2.appendText((d.who ? ' · ' : '') + [d.where, d.target && (d.where === 'result going back' ? 'from ' : 'to ') + d.target].filter(Boolean).join(' '));
    const rc = h.sp.src && h.sp.src.rec, dd = rc ? this.plugin.detailOf(rc) : null, ti = dd && dd.ev && dd.ev.tool_input;
    if (d.fibre || rc) this.tipEl.createDiv({ cls: 'cb-tip-3', text: [d.fibre && 'via ' + d.fibre, h.sp.src && (h.sp.src.sid || rc) ? 'click for everything about it' : ''].filter(Boolean).join(' · ') });
    const line = ti ? ti.command || ti.file_path || ti.notebook_path || ti.url || ti.query || ti.pattern || ti.description || '' : '';
    if (line) this.tipEl.createDiv({ cls: 'cb-tip-4', text: (ti.command ? '$ ' : '') + clip(String(line), 160) });
    this.tipEl.style.left = Math.min(this.cssW - 320, sx + 16) + 'px';
    this.tipEl.style.top = (sy + 14) + 'px';
    this.tipEl.addClass('is-on');
  }

  // the turn a record belongs to, as a tree: prompt → tool calls (with the commands of a shell chain) → subagents → their calls
  turnTree(sid, t) {
    const H = this.plugin.history.filter(r => r.sid === sid);
    if (!H.length) return null;
    let i0 = 0;
    for (let i = 0; i < H.length; i++) if (H[i].e === 'UserPromptSubmit' && H[i].t <= t) i0 = i;
    let i1 = H.length - 1;
    for (let i = i0 + 1; i < H.length; i++) if (H[i].e === 'UserPromptSubmit') { i1 = i - 1; break; }
    const items = H.slice(i0, i1 + 1);
    const posts = new Map();
    for (const r of items) if (r.id && /^(PostToolUse|PostToolUseFailure|PermissionDenied)$/.test(r.e)) posts.set(r.id, r);
    const root = { r: items[0], label: items[0].e === 'UserPromptSubmit' ? 'Your prompt' : 'Session', kind: 'prompt', children: [] };
    const agents = new Map(), openAgentCalls = [];
    const add = (node, parent) => { (parent || root).children.push(node); return node; };
    for (const r of items.slice(items[0].e === 'UserPromptSubmit' ? 1 : 0)) {
      const parent = r.aid ? agents.get(r.aid) || null : null;
      if (r.e === 'PreToolUse') {
        const post = r.id ? posts.get(r.id) : null;
        const n = { r, kind: r.cat || 'other', label: r.text || r.tool, status: post ? (post.e === 'PostToolUse' ? 'ok' : 'fail') : 'run', dur: post ? post.t - r.t : 0, children: [] };
        if (r.parts && r.parts.length > 1) for (const pt of r.parts) n.children.push({ kind: pt[0], label: pt[1], status: n.status, part: true, children: [] });
        add(n, r.aid ? parent || this.agentNode(agents, r, root) : null);
        if (!r.aid && /^(Agent|Task|Workflow)$/.test(r.tool)) openAgentCalls.push(n);
      } else if (r.e === 'SubagentStart' && r.aid) {
        const host = openAgentCalls.find(n => !n.taken) || null;
        if (host && !/^Workflow$/.test(host.r.tool)) host.taken = true;
        const g = { r, kind: 'agent', label: (r.agent || 'agent') + (r.wf ? ' (workflow)' : ''), status: 'run', children: [], t0: r.t };
        agents.set(r.aid, g);
        add(g, host);
      } else if (r.e === 'SubagentStop' && r.aid && agents.get(r.aid)) { const g = agents.get(r.aid); g.status = 'ok'; g.dur = r.t - g.t0; }
      else if (r.e === 'Message') add({ r, kind: 'speak', label: `Wrote ${r.text || 'a reply'}`, status: 'ok', children: [] }, parent);
      else if (r.e === 'PermissionRequest' || (r.e === 'Notification' && /permission|elicitation/.test(r.ntype || ''))) add({ r, kind: 'alarm', label: 'Waited for your approval', status: 'wait', children: [] }, parent);
      else if (r.e === 'TaskCreated' || r.e === 'TaskCompleted') add({ r, kind: r.e === 'TaskCompleted' ? 'reward' : 'plan', label: (r.e === 'TaskCompleted' ? 'Task done: ' : 'New task: ') + r.text, status: 'ok', children: [] }, parent);
      else if (r.e === 'PreCompact' || r.e === 'PostCompact' || r.e === 'InstructionsLoaded') add({ r, kind: r.e === 'InstructionsLoaded' ? 'self' : 'memory', label: r.e === 'InstructionsLoaded' ? 'Loaded ' + r.text : r.e === 'PreCompact' ? 'Compacting context' : 'Context compacted ' + (r.text || ''), status: 'ok', children: [] }, parent);
      else if (r.e === 'Stop' || r.e === 'StopFailure') add({ r, kind: r.e === 'Stop' ? 'prompt' : 'alarm', label: r.e === 'Stop' ? 'Finished, your turn' : 'Stopped: ' + r.text, status: r.e === 'Stop' ? 'ok' : 'fail', children: [] });
    }
    return root;
  }
  // play one recorded action again on the brain: same pathways, same gyri
  replayStrikes(r) {
    const s = this.plugin.sessions.get(r.sid) || { id: r.sid, color: r.color, idx: r.idx || 0 };
    const wasFrozen = this.frozen;
    if (wasFrozen) this.setTimeScale(0.25);
    this._src = { type: 'replay', rec: r, sid: r.sid, color: r.color };
    try { r.strikes.forEach((st, i) => this.strike(st, r.color || SIGNAL, 1, i * 110, { amp: 0.6 })); } finally { this._src = null; }
    this.flash('Replaying: ' + clip(r.text || r.e, 50));
  }
  agentNode(agents, r, root) {
    const g = { r, kind: 'agent', label: r.agent || 'agent', status: 'run', children: [] };
    agents.set(r.aid, g); root.children.push(g); return g;
  }

  // a record as a header, when the panel shows one that no spike carries
  describeRec(r) {
    if (!r) return { tag: 'SIGNAL', what: '', who: '', color: SIGNAL, where: '', target: '', fibre: '', agent: '' };
    const s = this.plugin.sessions.get(r.sid);
    const st = r.strikes && r.strikes[0];
    const tag = r.e === 'PreToolUse' ? (CAT[r.cat] || CAT.other).tag : ({ UserPromptSubmit: 'PROMPT', Stop: 'DONE', StopFailure: 'ERROR', SessionStart: 'WAKE', SubagentStart: 'AGENT', SubagentStop: 'AGENT', Message: 'WROTE', PostToolUse: 'RESULT', PostToolUseFailure: 'FAIL', PermissionDenied: 'DENIED', PermissionRequest: 'WAIT', Notification: 'WAIT', PreCompact: 'MEMORY', PostCompact: 'MEMORY', InstructionsLoaded: 'RECALL', TaskCreated: 'PLAN', TaskCompleted: 'DONE' }[r.e] || String(r.e || 'event').toUpperCase().slice(0, 10));
    const color = r.e === 'PreToolUse' ? catColor(r.cat) : /Failure|Denied/.test(r.e) ? ERR : r.color || SIGNAL;
    const what = r.e === 'PreToolUse' ? (r.text || r.tool) : r.e === 'SubagentStart' || r.e === 'SubagentStop' ? (r.agent || 'agent') + (r.e === 'SubagentStart' ? ' started' : ' finished')
      : r.e === 'UserPromptSubmit' ? 'Your prompt' : r.e === 'Message' ? 'Claude wrote ' + (r.text || 'a reply') : r.e === 'PostToolUse' ? (r.tool || 'tool') + ' result' : r.e === 'PostToolUseFailure' ? (r.tool || 'tool') + ' failed' : r.text || r.e;
    return { tag, what, who: r.label || (s ? this.plugin.sessionLabel(s) : ''), color, where: hhmm(r.t, true), target: st ? aalName(st.label) : '', fibre: '', agent: r.agent || '' };
  }
  // the records of one tool call: the call itself, approval prompts, and its result
  callRecs(rec) {
    const H = this.plugin.history, out = { pre: rec && rec.e === 'PreToolUse' ? rec : null, post: null, perm: [] };
    if (!rec || !rec.id) return out;
    for (let i = H.length - 1; i >= 0; i--) {
      const r = H[i];
      if (r.id !== rec.id || r.sid !== rec.sid) continue;
      if (r.e === 'PreToolUse') out.pre = r;
      else if (/^(PostToolUse|PostToolUseFailure|PermissionDenied)$/.test(r.e)) { if (!out.post) out.post = r; }
      else if (r.e === 'PermissionRequest') out.perm.unshift(r);
    }
    if (out.pre && !out.perm.length) {
      // approval prompts don't always carry the call's id: take the one for the same tool while it was waiting
      const end = out.post ? out.post.t : Infinity;
      for (const r of H) if (r.sid === rec.sid && r.e === 'PermissionRequest' && !r.id && r.tool === out.pre.tool && (r.aid || '') === (out.pre.aid || '') && r.t >= out.pre.t && r.t <= end) out.perm.push(r);
    }
    return out;
  }
  findRec(sid, test) { const H = this.plugin.history; for (let i = H.length - 1; i >= 0; i--) if (H[i].sid === sid && test(H[i])) return H[i]; return null; }
  goDetail(r) {
    const P = this.panel;
    if (!P || P.kind !== 'signal' || !r) return;
    const cur = P.sel || P.rec || (P.h && P.h.sp.src && P.h.sp.src.rec) || null;
    if (cur && cur !== r) (P.stack || (P.stack = [])).push(cur);
    P.sel = r; P.tab = 'detail';
    this.renderPanel(true);
    window.requestAnimationFrame(() => { this.panelEl.scrollTop = 0; });
  }
  // everything known about one record: who ran it, why, where it went, every parameter, the result, the raw hook events
  renderDetail(el, rec, P, H) {
    const p = this.plugin, { sec, row, kv, openFile } = H, now = Date.now();
    const open = P.open || (P.open = new Set());
    const set = this.callRecs(rec), pre = set.pre, post = set.post;
    const D = p.detailOf(rec), Dpre = pre ? p.detailOf(pre) : null, Dpost = post ? p.detailOf(post) : null;
    const ev = (Dpre && Dpre.ev) || (D && D.ev) || null;
    const isCall = !!pre || /^(PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest|PermissionDenied)$/.test(rec.e);
    const ti = (ev && ev.tool_input) || {};
    const tool = (pre && pre.tool) || rec.tool || (ev && ev.tool_name) || '';
    const block = (label, text, o) => {
      o = o || {};
      text = String(text == null ? '' : text);
      if (!text.trim() && !o.keepEmpty) return null;
      const key = rec.t + '|' + rec.e + '|' + label;
      const max = o.lines != null ? o.lines : 8, chars = o.chars != null ? o.chars : 700, lines = text.split('\n'), long = lines.length > max || text.length > chars;
      const isOpen = open.has(key) || !long;
      const b = el.createDiv({ cls: 'cb-d-blk' + (o.cls ? ' ' + o.cls : '') });
      const hd = b.createDiv({ cls: 'cb-d-bh' });
      hd.createSpan({ cls: 'cb-d-bl', text: label });
      if (o.note) hd.createSpan({ cls: 'cb-d-bn', text: o.note });
      const acts = hd.createSpan({ cls: 'cb-d-acts' });
      if (long) {
        const t = acts.createEl('button', { cls: 'cb-d-act', text: isOpen ? 'Less' : lines.length > max ? `All ${lines.length} lines` : `All ${text.length.toLocaleString('en-US')} characters` });
        t.addEventListener('click', () => { if (open.has(key)) open.delete(key); else open.add(key); this.renderPanel(true); });
      }
      const c = acts.createEl('button', { cls: 'cb-d-act', text: 'Copy' });
      c.addEventListener('click', () => { navigator.clipboard.writeText(o.copy != null ? o.copy : text); this.flash('Copied ' + label.toLowerCase()); });
      if (!isOpen && (!max || !chars)) { b.addClass('is-shut'); return b; }
      const pr = b.createEl('pre', { cls: 'cb-d-pre' + (isOpen ? '' : o.tail ? ' is-clip is-tail' : ' is-clip') });
      if (isOpen) pr.setText(text);
      else if (o.tail) pr.setText('…' + lines.slice(-max).join('\n').slice(-chars));
      else pr.setText(lines.slice(0, max).join('\n').slice(0, chars));
      return b;
    };
    const json = (v) => { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } };
    const field = (k, v) => {
      if (typeof v === 'string') {
        if (k === 'old_string' || k === 'new_string') return block(k, v, { cls: k === 'old_string' ? 'is-old' : 'is-new', keepEmpty: true });
        if (v.length <= 90 && !v.includes('\n') && k !== 'command' && k !== 'prompt' && k !== 'content') return kv(k, v, { mono: true });
        return block(k, v, { lines: k === 'command' ? 30 : 8 });
      }
      if (v == null || typeof v !== 'object') return kv(k, String(v), { mono: true });
      if (k === 'todos' && Array.isArray(v)) return block('todos', v.map(t => (t && t.status === 'completed' ? '✓ ' : t && t.status === 'in_progress' ? '▸ ' : '· ') + (t && (t.content || t.subject) || '')).join('\n'), { copy: json(v) });
      return block(k, json(v));
    };
    const fields = (obj, skip) => { for (const k of Object.keys(obj || {})) if (!skip || !skip.has(k)) field(k, obj[k]); };
    const status = isCall ? (post ? (post.e === 'PostToolUse' ? 'ok' : post.e === 'PermissionDenied' ? 'denied' : 'fail') : set.perm.length ? 'wait' : 'run') : '';
    const s = p.sessions.get(rec.sid);

    // ---- what and when
    sec(isCall ? 'Call' : 'Event', hhmm(rec.t, true));
    if (isCall) {
      kv('Tool', toolLabel(tool) + (tool.startsWith('mcp__') ? '  (' + tool + ')' : ''));
      const st = { ok: `✓ finished in ${post ? fmtDur(post.t - (pre || rec).t) : ''}`, fail: '✗ failed' + (post ? ` after ${fmtDur(post.t - (pre || rec).t)}` : ''), denied: '✗ denied', wait: '◆ waiting for your approval', run: `▸ running for ${fmtDur(now - (pre || rec).t)}` }[status];
      kv('Status', st, { color: status === 'ok' ? '#7fdca4' : status === 'run' ? '#c9d1dc' : status === 'wait' ? WAIT : ERR });
      if (pre && pre.id) kv('Call id', pre.id, { mono: true, click: () => { navigator.clipboard.writeText(pre.id); this.flash('Call id copied'); }, tip: 'Copy' });
    } else kv('Event', rec.e);
    if (!D && !Dpre && !Dpost) {
      row('is-empty').setText(p.settings.callDetails === false ? 'Full call details are off (Settings → Inspector).' : 'The full details of this event are no longer kept (memory budget), or it came from a server\'s offline queue, which keeps only short labels.');
    }

    if (!isCall && D && D.ev) {
      const e0 = D.ev;
      if (rec.e === 'UserPromptSubmit' && e0.prompt) block('Your prompt', e0.prompt, { lines: 14 });
      if (rec.e === 'Message' && e0.text) block('Claude wrote', e0.text, { lines: 14 });
      if ((rec.e === 'SubagentStop' || rec.e === 'Stop') && e0.last_assistant_message) block(rec.e === 'Stop' ? 'Claude\'s last message' : 'The agent\'s final report', e0.last_assistant_message, { lines: 14 });
    }
    // ---- who
    sec('Who');
    kv('Session', rec.label || (s ? p.sessionLabel(s) : rec.sid), { color: rec.color });
    kv('Machine', !rec.src || rec.src === 'local' ? 'this computer' : rec.src);
    const ag = (Dpre && Dpre.agent) || (D && D.agent) || null;
    if (rec.aid || ag) {
      // the agent chain: main › agent › agent
      const chain = [];
      let cur = ag, guard = 0;
      while (cur && guard++ < 6) {
        chain.unshift((cur.type || 'agent') + (cur.wf ? ' (workflow)' : ''));
        if (!cur.parent) break;
        const pr = this.findRec(rec.sid, r => r.aid === cur.parent);
        const pd = pr ? p.detailOf(pr) : null;
        cur = pd && pd.agent ? pd.agent : pr ? { type: pr.agent, parent: '' } : null;
      }
      chain.unshift('main');
      kv('Agent', chain.join(' › '));
      kv('Agent id', (ag && ag.id) || rec.aid, { mono: true });
      const spawnId = ag && ag.spawn;
      const spawn = spawnId ? this.findRec(rec.sid, r => r.e === 'PreToolUse' && r.id === spawnId) : null;
      if (spawn) kv('Started by', (spawn.aid ? spawn.agent + ': ' : 'main: ') + (spawn.text || spawn.tool), { click: () => this.goDetail(spawn), tip: 'Show that call' });
      else if (ag && ag.desc) kv('Started for', ag.desc);
    } else kv('Agent', 'main');
    const cwd = (ev && ev.cwd) || rec.cwd;
    if (cwd) kv('Folder', cwd, { mono: true, click: () => { navigator.clipboard.writeText(cwd); this.flash('Folder copied'); }, tip: 'Copy' });
    if (Dpre && Dpre.mode) kv('Permissions', Dpre.mode);
    for (const pr of set.perm) kv('Approval', `asked you at ${hhmm(pr.t, true)}` + (post && post.e !== 'PermissionDenied' ? ', approved' : post ? ', denied' : ''), { color: WAIT });

    // ---- why
    const spawnOf = (a) => a && a.spawn ? this.findRec(rec.sid, r => r.e === 'PreToolUse' && r.id === a.spawn) : null;
    const desc = typeof ti.description === 'string' ? ti.description : '';
    const said = Dpre && Dpre.said;
    const step = Dpre && Dpre.step;
    const spawnRec = spawnOf(ag), spawnD = spawnRec ? p.detailOf(spawnRec) : null;
    const task = spawnD && spawnD.ev && spawnD.ev.tool_input ? spawnD.ev.tool_input.prompt : '';
    const promptRec = this.findRec(rec.sid, r => r.e === 'UserPromptSubmit' && r.t <= rec.t);
    const promptD = promptRec ? p.detailOf(promptRec) : null;
    const prompt = promptD && promptD.ev ? promptD.ev.prompt : '';
    if (isCall && (desc || said || step || task || prompt)) {
      sec('Why');
      if (desc) kv('Its own words', desc);
      if (step) kv('Plan step', step);
      if (said) block('Claude said just before', said, { tail: true, lines: 6 });
      if (task) block(`Task given to ${ag.type || 'this agent'}`, task, { lines: 6 });
      if (prompt && promptRec !== rec) block('Your request (this turn)', prompt, { lines: 4, note: hhmm(promptRec.t) });
    }

    // ---- where it goes
    if (isCall) {
      sec('Where it goes');
      const fp = ti.file_path || ti.notebook_path;
      if (fp) {
        const rel = p.toVaultRel(fp, cwd);
        kv('File', fp, { mono: true, click: () => openFile(rel && this.byPath.get(rel) ? rel : fp), tip: rel ? 'Open the note' : 'Copy the path' });
        if (rel) kv('In your vault', rel || '/');
      }
      if (tool === 'Grep' || tool === 'Glob') {
        kv('Looks for', ti.pattern, { mono: true });
        kv('In', ti.path || cwd || '', { mono: true });
        if (ti.glob || ti.type) kv('Only', ti.glob || ti.type, { mono: true });
      } else if (ti.path && !fp) kv('Path', ti.path, { mono: true });
      if (ti.url) { kv('Address', ti.url, { mono: true, click: () => { navigator.clipboard.writeText(ti.url); this.flash('Address copied'); }, tip: 'Copy' }); try { kv('Host', new URL(ti.url).hostname, { mono: true }); } catch (e) { /* not a URL */ } }
      if (tool === 'WebSearch') { kv('Searches the web for', ti.query); if (ti.allowed_domains) kv('Only on', [].concat(ti.allowed_domains).join(', ')); if (ti.blocked_domains) kv('Never on', [].concat(ti.blocked_domains).join(', ')); }
      if ((tool === 'Bash' || tool === 'PowerShell') && ti.command) {
        const parts = tool === 'Bash' ? bashParts(String(ti.command), 14) : [{ cat: evCat({ tool_name: tool, tool_input: ti }), cmd: String(ti.command).trim().split(/\s+/)[0] }];
        if (parts.length) {
          const r = row('cb-d-steps'); r.createSpan({ cls: 'cb-p-k', text: parts.length > 1 ? 'Steps' : 'Program' });
          const box = r.createSpan({ cls: 'cb-p-x' });
          parts.forEach((pt, i) => {
            if (i) box.createSpan({ cls: 'cb-d-arrow', text: '→' });
            const c = box.createSpan({ cls: 'cb-d-chip', text: pt.cmd || pt.cat }); c.style.borderColor = catColor(pt.cat); c.setAttr('title', (CAT[pt.cat] || CAT.other).tag.toLowerCase() + ': ' + LOBES[(CAT[pt.cat] || CAT.other).lobe].fn);
          });
        }
        const names = { url: 'Web address', host: 'Remote host', git: 'Git remote', writes: 'Writes to', cd: 'Moves to', as: 'Runs as' };
        for (const [k, v] of shellTargets(ti.command)) kv(names[k] || k, v, { mono: true });
        if (ti.run_in_background) kv('Runs', 'in the background');
        if (ti.timeout) kv('Time limit', fmtDur(Number(ti.timeout)));
      }
      if (tool.startsWith('mcp__')) { const [, server, ...rest] = tool.split('__'); kv('MCP server', server, { mono: true }); kv('MCP tool', rest.join('__'), { mono: true }); }
      if (/^(Agent|Task)$/.test(tool)) {
        const st0 = String(ti.subagent_type || 'general-purpose');
        kv('Starts', `${/^[aeiou]/i.test(st0) ? 'an' : 'a'} ${st0} subagent` + (ti.model ? ` on ${ti.model}` : '') + (ti.run_in_background ? ', in the background' : ''));
        const callId = pre && pre.id;
        const startRec = callId ? this.findRec(rec.sid, r => r.e === 'SubagentStart' && (p.detailOf(r) || {}).agent && p.detailOf(r).agent.spawn === callId) : null;
        if (startRec) {
          const n = p.history.filter(r => r.sid === rec.sid && r.aid === startRec.aid && r.e === 'PreToolUse').length;
          kv('Its agent', `${startRec.agent || 'agent'} · ${n} tool call${n === 1 ? '' : 's'} so far`, { click: () => this.goDetail(startRec), tip: 'Show the agent' });
        }
      }
      if (tool === 'Workflow') kv('Starts', 'workflow ' + workflowName(ti));
      if (tool === 'Skill') kv('Skill', ti.skill || ti.name || ti.command, { mono: true });
    }
    // where it lands in the brain, and why there
    const strikes = (pre && pre.strikes && pre.strikes.length ? pre.strikes : rec.strikes) || [];
    if (strikes.length) {
      sec('In the brain', strikes.length > 1 ? strikes.length + ' places' : '');
      const G = p.geo, kinds = [];
      for (const st of strikes.slice(0, 10)) {
        const r = row('cb-d-route');
        const t = r.createSpan({ cls: 'cb-p-tag', text: KIND_TAG[st.kind] || st.kind }); t.style.color = st.hex || SIGNAL;
        const via = st.fibre && G && G.bundleOf ? G.bundleOf[st.fibre.i] : '';
        r.createSpan({ cls: 'cb-p-x', text: aalName(st.label) + (st.nucleus ? ' + ' + st.nucleus.toLowerCase() : '') + (via ? ', via the ' + bundleName(via) : '') + (st.what && strikes.length > 1 ? '  ·  ' + st.what : '') });
        if (!kinds.includes(st.kind)) kinds.push(st.kind);
      }
      for (const k of kinds) if (KIND_WHY[k]) row('cb-d-why').setText(KIND_WHY[k]);
    }

    // ---- parameters: every field the tool was called with
    if (isCall && ev && ev.tool_input && typeof ev.tool_input === 'object') {
      const n = Object.keys(ev.tool_input).length;
      const h = sec('Parameters', '');
      const cp = h.createEl('button', { cls: 'cb-d-act', text: `Copy JSON (${n} field${n === 1 ? '' : 's'})` });
      cp.addEventListener('click', () => { navigator.clipboard.writeText(json(ev.tool_input)); this.flash('Parameters copied'); });
      if (!n) row('is-empty').setText('No parameters.');
      fields(ev.tool_input);
    }

    // ---- what the event itself carried (prompts, replies, agents, notifications)
    if (!isCall && D && D.ev) {
      const e = D.ev, common = new Set(['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'permission_mode', 'agent_id', 'agent_type']);
      if (rec.e === 'SubagentStart' || rec.e === 'SubagentStop') {
        const calls = p.history.filter(r => r.sid === rec.sid && r.aid === rec.aid && r.e === 'PreToolUse');
        if (calls.length) {
          sec('Its calls', String(calls.length));
          for (const c of calls.slice(-40)) { const r = row('is-click cb-p-ev'); r.createSpan({ cls: 'cb-p-t', text: hhmm(c.t, true) }); const t = r.createSpan({ cls: 'cb-p-tag', text: (CAT[c.cat] || CAT.other).tag.toLowerCase() }); t.style.color = catColor(c.cat); r.createSpan({ cls: 'cb-p-x', text: c.text || c.tool }); r.addEventListener('click', () => this.goDetail(c)); }
        }
      }
      const skip = new Set([...common, 'prompt', 'text', 'last_assistant_message']);
      if (Object.keys(e).some(k => !skip.has(k))) { sec('Fields'); fields(e, skip); }
    }

    // ---- result
    if (isCall) {
      sec('Result', post ? hhmm(post.t, true) : '');
      if (!post) row('is-empty').setText(status === 'wait' ? 'Waiting for your approval.' : 'Still running. The result shows here when it comes back.');
      else if (!Dpost) row('is-empty').setText(post.e === 'PostToolUse' ? `Finished${post.size ? `, about ${post.size.toLocaleString('en-US')} characters of output` : ''}. The output itself is no longer kept.` : 'Failed. The error text is no longer kept.');
      else {
        const e = Dpost.ev || {};
        if (post.e === 'PostToolUseFailure') { block('Error', e.error || e.message || 'failed', { cls: 'is-err', lines: 12 }); if (e.is_interrupt) kv('Interrupted', 'yes, by you'); }
        if (post.e === 'PermissionDenied') kv('Denied', e.reason || e.message || 'the call was not allowed', { color: ERR });
        const r = e.tool_response;
        if (typeof r === 'string') block('Output', r, { lines: 14 });
        else if (r && typeof r === 'object') {
          const shown = new Set();
          for (const k of ['stdout', 'stderr', 'output', 'result', 'content', 'text', 'error']) {
            if (typeof r[k] === 'string' && r[k].trim()) { block(k, r[k], { lines: 14, cls: k === 'stderr' || k === 'error' ? 'is-err' : '' }); shown.add(k); }
          }
          if (r.file && typeof r.file === 'object') {
            if (r.file.numLines != null) kv('Lines', `${r.file.numLines}${r.file.totalLines ? ' of ' + r.file.totalLines : ''}${r.file.startLine > 1 ? ', from line ' + r.file.startLine : ''}`);
            if (typeof r.file.content === 'string') block('content', r.file.content, { lines: 10 });
          }
          if (r.interrupted) kv('Interrupted', 'yes');
          if (r.returnCodeInterpretation) kv('Exit', r.returnCodeInterpretation);
          if (Array.isArray(r.content)) block('content', r.content.map(c => c && typeof c === 'object' ? (c.text != null ? c.text : json(c)) : String(c)).join('\n'), { lines: 14 });
          block('Full response', json(r), { lines: 3 });
        }
        if (!r && post.e === 'PostToolUse') row('is-empty').setText('Finished. Claude Code sent no output for this call.');
      }
    }

    // ---- the raw hook events, exactly as kept
    const raws = (isCall ? [pre, ...set.perm, post] : [rec]).filter(Boolean).map(r => [r, p.detailOf(r)]).filter(x => x[1] && x[1].ev);
    if (raws.length) {
      sec('Raw hook events', 'as Claude Code sent them');
      for (const [r, d] of raws) block(`${r.e} · ${hhmm(r.t, true)}`, json(d.ev), { lines: 0, chars: 0 });
    }
  }

  toggleFocus(sid) {
    if (this.mini) { this.plugin.activateView(); return; }
    if (this.focusSid === sid) { this.focusSid = null; if (this.panel && this.panel.kind === 'session') this.closePanel(); }
    else { this.focusSid = sid; this.openPanel({ kind: 'session', id: sid }); }
    this.needsDraw = true;
    this.requestHud();
  }

  panelWidth() { return !this.panel || this.mini ? 0 : this.contentEl.hasClass('cb-panel-wide') ? Math.min(560, (this.cssW || 800) - 24) : 330; }
  togglePanel(p) {
    if (this.panel && this.panel.kind === p.kind && this.panel.id === p.id && this.panel.aal === p.aal) this.closePanel(); else this.openPanel(p);
  }
  openPanel(p) {
    if (this.mini) return;
    this.panel = p;
    this.applyLayout();
    this.renderPanel(true);
    window.requestAnimationFrame(() => { if (this.panelEl) this.panelEl.scrollTop = 0; });
  }
  closePanel() {
    if (this.panel && this.panel.kind === 'session') this.focusSid = null;
    this.panel = null;
    this.panelEl.empty();
    this.applyLayout();
    this.requestHud();
  }

  // force: re-render even when nothing it shows has changed (the call inspector otherwise keeps still, so you can
  // select and copy from it while events stream in)
  renderPanel(force) {
    const el = this.panelEl, P = this.panel, p = this.plugin, now = Date.now();
    if (!el || !P) return;
    if (P.kind === 'signal') {
      const sel = P.sel || P.rec || (P.h && P.h.sp.src && P.h.sp.src.rec) || null, cs = sel ? this.callRecs(sel) : null;
      const sig = [P.tab, sel ? sel.t + sel.e : '', cs && cs.post ? cs.post.e : '', cs ? cs.perm.length : 0, P.tab === 'tree' ? p.history.length : 0, sel && p.detailOf(sel) ? 1 : 0, (P.stack || []).length].join('|');
      if (!force && sig === P._sig && !(cs && cs.pre && !cs.post)) return;
      if (!force && sig === P._sig && el.contains(document.activeElement)) return;
      if (!force && sig === P._sig && window.getSelection && String(window.getSelection()).length) return;
      P._sig = sig;
    }
    const keepScroll = el.scrollTop;
    window.requestAnimationFrame(() => { el.scrollTop = keepScroll; });
    el.empty();
    const head = el.createDiv({ cls: 'cb-p-head' });
    const close = head.createEl('button', { cls: 'cb-p-close', text: '×' });
    close.setAttr('title', 'Close (Esc)');
    close.addEventListener('click', () => this.closePanel());
    const sec = (title, right) => { const h = el.createDiv({ cls: 'cb-p-sec' }); h.createSpan({ text: title }); if (right) h.createSpan({ cls: 'cb-p-sec-r', text: right }); return h; };
    const row = (cls) => el.createDiv({ cls: 'cb-p-row' + (cls ? ' ' + cls : '') });
    const openFile = (path) => {
      const n = this.byPath.get(path);
      if (n && !n.learned) this.app.workspace.openLinkText(path, '', true);
      else { navigator.clipboard.writeText(path); this.flash('Path copied'); }
    };
    const evRow = (r, withSession) => {
      const d = row('cb-p-ev');
      d.createSpan({ cls: 'cb-p-t', text: hhmm(r.t, true) });
      const dot = d.createSpan({ cls: 'cb-p-evdot' });
      dot.style.background = r.e === 'PreToolUse' ? catColor(r.cat) : r.e === 'Notification' ? WAIT : r.e === 'PostToolUseFailure' ? '#ff6b6b' : '#5d6574';
      if (withSession) { const w = d.createSpan({ cls: 'cb-p-who', text: r.label + (r.agent ? ' › ' + r.agent : '') }); w.style.color = r.color; }
      else if (r.agent) { const w = d.createSpan({ cls: 'cb-p-who', text: r.agent }); w.style.color = r.color; }
      d.createSpan({ cls: 'cb-p-x', text: r.text || ({ SubagentStart: 'Started', SubagentStop: 'Finished', Stop: 'Finished, your turn', UserPromptSubmit: 'New prompt', SessionStart: 'Session started', SessionEnd: 'Session ended', PostToolUseFailure: (r.tool || 'Tool') + ' failed', PreCompact: 'Compacting context' }[r.e] || '') });
      d.addClass('is-click'); d.setAttr('title', 'Show everything about it');
      d.addEventListener('click', () => this.openPanel({ kind: 'signal', rec: r, tab: 'detail', back: Object.assign({}, this.panel) }));
    };

    if (P.kind === 'session') {
      const s = p.sessions.get(P.id);
      const recs = p.history.filter(r => r.sid === P.id);
      const color = s ? s.color : (recs[0] && recs[0].color) || '#8b93a1';
      const title = head.createDiv({ cls: 'cb-p-title' });
      const dot = title.createSpan({ cls: 'cb-p-dot' }); dot.style.background = color;
      const nm = title.createSpan({ text: s ? p.sessionLabel(s) : (recs[0] && recs[0].label) || 'session' }); nm.style.color = color;
      head.createDiv({ cls: 'cb-p-sub', text: s ? `${s.wait && s.wait.kind === 'approval' ? 'Needs your approval' : cap(s.state)} for ${p.isLive(s) || (s.wait && s.wait.kind === 'approval') ? fmtDur(now - (s.wait ? s.wait.since : s.since)) : fmtAgo(now - s.at)}, on ${s.src === 'local' || !s.src ? 'this computer' : s.src}` : 'This session has ended.' });
      if (s && s.alarm) {
        sec('May be stuck', fmtAgo(now - s.alarm.since) + ' ago');
        const r = row('cb-p-alarm'); r.createSpan({ cls: 'cb-p-x', text: s.alarm.text });
        const b = r.createEl('button', { cls: 'cb-p-btn', text: 'Dismiss' }); b.addEventListener('click', () => { p.clearAlarm(s); this.renderPanel(); });
      }
      const M = p.metab.get(P.id);
      if (M && M.calls) {
        sec('Energy', M.model ? M.model.replace(/^claude-/, '') : '');
        const line = (a, b) => { const r = row(); r.createSpan({ cls: 'cb-p-x', text: a }); r.createSpan({ cls: 'cb-p-t', text: b }); };
        const cachePct = M.inTok + M.cacheRead + M.cacheWrite ? Math.round(100 * M.cacheRead / (M.inTok + M.cacheRead + M.cacheWrite)) : 0;
        line(`${M.calls} model call${M.calls === 1 ? '' : 's'}, ${(M.ms / M.calls / 1000).toFixed(1)} s on average`, M.cost > 0 ? `$${M.cost.toFixed(2)}` : '');
        line(`${fmtTok(M.inTok + M.cacheRead + M.cacheWrite)} tokens read (${cachePct}% from cache), ${fmtTok(M.outTok)} written`, '');
        if (M.ctx) { const lim = ctxLimit(M); line(`Working memory: ${fmtTok(M.ctx)} of ${fmtTok(lim)} context`, Math.round(100 * M.ctx / lim) + '%'); }
        if (M.errors) line(`${M.errors} API error${M.errors === 1 ? '' : 's'}`, '');
      }
      if (s) {
        const pl = p.plan(s);
        const list = s.tasks && s.tasks.size ? [...s.tasks.values()].filter(t => t.status !== 'deleted') : (s.todo || []);
        if (list.length) {
          sec('Plan', pl ? `${pl.done} of ${pl.total} done` : '');
          for (const t of list) { const r = row('cb-p-task is-' + t.status); r.createSpan({ cls: 'cb-p-i', text: t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·' }); r.createSpan({ text: clip(t.subject, 60) }); }
        }
        const ags = [...s.agents.values()].sort((m, n) => n.start - m.start).slice(0, 8);
        if (s.workflow || ags.length) {
          sec('Agents', s.workflow ? `workflow ${s.workflow.name}` : '');
          if (s.workflow) { const r = row(); r.createSpan({ cls: 'cb-p-i', text: '⚙' }); r.createSpan({ cls: 'cb-p-x', text: s.workflow.active ? `${p.runningAgents(s).filter(x => x.wf).length} running, ${s.workflow.done} done` : `Finished with ${s.workflow.done} agents` }); r.createSpan({ cls: 'cb-p-t', text: fmtDur((s.workflow.active ? now : s.workflow.endedAt) - s.workflow.since) }); }
          for (const x of ags) {
            const r = row(x.done ? 'is-over' : '');
            r.createSpan({ cls: 'cb-p-i', text: x.done ? '✓' : x.wf ? '·' : '↳' });
            const w = r.createSpan({ cls: 'cb-p-who', text: x.type }); w.style.color = color;
            r.createSpan({ cls: 'cb-p-x', text: clip(cap(x.done ? `finished after ${x.tools} tool call${x.tools === 1 ? '' : 's'}` : x.inTool ? x.last : x.desc || x.last), 44) });
            r.createSpan({ cls: 'cb-p-t', text: fmtDur((x.done ? x.doneAt : now) - x.start) });
          }
        }
      }
      const D = p.daily && p.daily.sessions[P.id];
      if (D && Object.keys(D.files).length) {
        sec('Files today', String(Object.keys(D.files).length));
        for (const [f, n] of Object.entries(D.files).sort((m, q) => q[1] - m[1]).slice(0, 12)) {
          const r = row('is-click cb-p-file'); r.createSpan({ cls: 'cb-p-x', text: f }); r.createSpan({ cls: 'cb-p-t', text: n + '×' });
          r.addEventListener('click', () => openFile(f));
        }
      }
      sec('Recent events', String(recs.length));
      for (const r of recs.filter(x => x.e !== 'PostToolUse').slice(-20).reverse()) evRow(r, false);
      return;
    }

    if (P.kind === 'signal') {
      const h = P.h || null, src = h ? h.sp.src || {} : {}, rec0 = src.rec || P.rec || null;
      const sel = P.sel || rec0, onSignal = !!h && sel === rec0;
      const d = onSignal || !sel ? (h ? this.describeSpike(h) : this.describeRec(null)) : this.describeRec(sel);
      const sid = src.sid || (sel && sel.sid) || (rec0 && rec0.sid);
      if (!P.tab) P.tab = 'detail';
      const title = head.createDiv({ cls: 'cb-p-title' });
      const dot = title.createSpan({ cls: 'cb-p-dot' }); dot.style.background = d.color;
      const tg = title.createSpan({ cls: 'cb-p-tagb', text: d.tag }); tg.style.color = d.color;
      title.createSpan({ text: ' ' + clip(d.what, 72) });
      head.createDiv({ cls: 'cb-p-sub', text: [d.who && d.who + (d.agent ? ' › ' + d.agent : ''), d.where, d.target && (h && h.sp.back && onSignal ? 'from ' : 'to ') + d.target].filter(Boolean).join(' · ') });
      const nav = head.createDiv({ cls: 'cb-p-tabs' });
      if ((P.stack && P.stack.length) || P.back) {
        const bk = nav.createEl('button', { cls: 'cb-p-tabb cb-p-backb', text: '‹ Back' });
        bk.addEventListener('click', () => { if (P.stack && P.stack.length) { P.sel = P.stack.pop(); P.tab = 'detail'; this.renderPanel(true); } else this.openPanel(P.back); });
      }
      const tab = (k, label) => { const b = nav.createEl('button', { cls: 'cb-p-tabb' + (P.tab === k ? ' is-on' : ''), text: label }); b.addEventListener('click', () => { P.tab = k; this.renderPanel(true); }); };
      tab('detail', 'Details');
      if (sid) tab('tree', 'Operation tree');
      if (sel && sel.strikes && sel.strikes.length) { const rp = nav.createEl('button', { cls: 'cb-p-tabb', text: '↻ Replay' }); rp.setAttr('title', 'Play this action again on the brain'); rp.addEventListener('click', () => this.replayStrikes(sel)); }
      const kv = (k, v, o) => {
        if (v == null || v === '') return null;
        o = o || {};
        const r = row(o.cls || ''); r.createSpan({ cls: 'cb-p-k', text: k });
        const x = r.createSpan({ cls: 'cb-p-x' + (o.mono ? ' is-mono' : ''), text: String(v) });
        if (o.color) x.style.color = o.color;
        if (o.click) { r.addClass('is-click'); r.addEventListener('click', o.click); if (o.tip) r.setAttr('title', o.tip); }
        return r;
      };
      if (P.tab === 'tree' && sid) {
        const tree = this.turnTree(sid, sel ? sel.t : rec0 ? rec0.t : Date.now());
        if (!tree) { row('is-empty').setText('Nothing recorded for this turn.'); return; }
        sec('Operation tree', 'click a line for its details');
        const walk = (n, depth, last, pre) => {
          const r = row('cb-p-tree' + (sel && n.r === sel ? ' is-sel' : '') + (n.r ? ' is-click' : ''));
          r.createSpan({ cls: 'cb-p-tr', text: depth ? pre + (last ? '└ ' : '├ ') : '' });
          r.createSpan({ cls: 'cb-p-st is-' + n.status, text: { ok: '✓', fail: '✗', run: '▸', wait: '◆' }[n.status] || '·' });
          const tg2 = r.createSpan({ cls: 'cb-p-tag', text: KIND_TAG[n.kind] || n.kind }); tg2.style.color = n.status === 'fail' ? ERR : CAT[n.kind] ? catColor(n.kind) : KIND_HEX[n.kind] || '#8b93a1';
          r.createSpan({ cls: 'cb-p-x', text: n.label });
          r.createSpan({ cls: 'cb-p-t', text: n.dur ? fmtDur(n.dur) : n.r && !n.part ? hhmm(n.r.t) : '' });
          if (n.r && n.r.strikes && n.r.strikes.length) {
            const rp = r.createSpan({ cls: 'cb-p-rep', text: '↻' }); rp.setAttr('title', 'Replay on the brain');
            rp.addEventListener('click', (e) => { e.stopPropagation(); this.replayStrikes(n.r); });
          }
          if (n.r) r.addEventListener('click', () => this.goDetail(n.r));
          n.children.forEach((c, i) => walk(c, depth + 1, i === n.children.length - 1, depth ? pre + (last ? '   ' : '│  ') : ''));
        };
        walk(tree, 0, true, '');
        window.requestAnimationFrame(() => { const se = el.querySelector('.cb-p-tree.is-sel'); if (se) se.scrollIntoView({ block: 'center' }); });
        return;
      }
      if (onSignal || (h && !sel)) {
        sec('This signal');
        if (h.kind === 'tract') kv('Pathway', bundleName(h.sp.l.bundle) + (h.sp.back ? ', travelling back' : ''));
        if (src.st) kv('Lands in', aalName(src.st.label) + (src.st.nucleus ? ' and the ' + src.st.nucleus.toLowerCase() : ''));
        if (src.st) kv('Kind of work', (KIND_TAG[src.st.kind] || src.st.kind) + (src.st.what ? ' · ' + src.st.what : ''));
        if (src.type === 'think') { const M = p.metab.get(src.sid); kv('What it is', 'One of the spikes that keep circulating through prefrontal loops while the model deliberates.'); if (M && M.calls) kv('Energy so far', `${M.calls} model calls · ${fmtTok(M.outTok)} tokens written · working memory ${fmtTok(M.ctx)}`); }
        if (src.type === 'body') { const V = p.vitals.get(src.machine || 'local'); kv('What it is', 'A body signal from the machine, not from Claude.'); if (V) kv('Now', `cpu ${Math.round((V.cpu || 0) * 100)}% · memory ${Math.round((V.mem || 0) * 100)}%` + (V.rx != null ? ` · network ${fmtRate((V.rx || 0) + (V.tx || 0))}` : '')); }
        if (src.type === 'dream') kv('What it is', 'A replay while nothing runs. The original happened at ' + hhmm(src.t) + '.');
        if (src.type === 'running') kv('What it is', 'The call is still running; these spikes keep its pathway alive until the result comes back.');
        if (h.kind === 'note') { kv('From', h.sp.a.name); kv('To', h.sp.b.name); }
      }
      if (sel) this.renderDetail(el, sel, P, { sec, row, kv, openFile });
      else if (!h) row('is-empty').setText('Nothing to show.');
      return;
    }

    if (P.kind === 'inner') {
      const INFO = {
        'Thalamus': ['The relay station. Every prompt and tool call passes through it, and results come back to it; your hub notes live here.', ['UserPromptSubmit', 'Stop', 'PostToolBatch']],
        'Caudate nucleus': ['Picks the next action. Lights up when Claude runs commands, plans and thinks, and gets a small reward signal when a task is done.', ['exec', 'plan', 'TaskCompleted']],
        'Putamen': ['Turns plans into movement. Lights up when Claude writes or edits files.', ['write']],
        'Globus pallidus': ['Gates what gets through. Lights up for services, packages and integrations.', ['ops', 'mcp']],
        'Hippocampus': ['Memory. Lights up when Claude reads or searches, loads its instructions, compacts its context, recalls context from cache, and when a new connection is learned.', ['read', 'InstructionsLoaded', 'PreCompact', 'PostCompact']],
        'Amygdala': ['Alarm. Glows amber while a session waits for your approval, red when something fails or a session may be stuck.', ['Notification', 'PermissionRequest', 'PostToolUseFailure', 'PermissionDenied', 'StopFailure']],
      };
      const info = INFO[P.id] || ['', []];
      const title = head.createDiv({ cls: 'cb-p-title' });
      const it = (this.innerBy[P.id] || [])[0];
      const sw = title.createSpan({ cls: 'cb-p-dot' }); sw.style.background = it ? '#' + it.mat.uniforms.uColor.value.getHexString() : '#888';
      title.createSpan({ text: P.id });
      head.createDiv({ cls: 'cb-p-sub', text: info[0] });
      this.memorySection(el, 'n:' + P.id, sec, row, it && it.eng ? 1 - Math.exp(-it.eng * p.engK() * 0.1) : 0, 'Its memory');
      const recs = p.history.filter(r => info[1].includes(r.e) || (r.e === 'PreToolUse' && info[1].includes(r.cat)));
      sec('Recent activity', recs.length ? String(recs.length) : '');
      if (!recs.length) row('is-empty').setText('Nothing has happened here in the last 6 hours.');
      for (const r of recs.slice(-14).reverse()) evRow(r, true);
      return;
    }

    // region
    const k = P.id, i = LOBE_ORDER.indexOf(k);
    const title = head.createDiv({ cls: 'cb-p-title' });
    const sw = title.createSpan({ cls: 'cb-p-dot is-sq' }); sw.style.background = LOBES[k].color;
    title.createSpan({ text: cap(LOBES[k].label.toLowerCase()) });
    const lv = p.traceLevels();
    if (P.aal) head.createDiv({ cls: 'cb-p-gyrus', text: aalName(P.aal) });
    head.createDiv({ cls: 'cb-p-sub', text: `Handles ${LOBES[k].fn.replace(' · ', ' and ')}. ${(this.counts && this.counts[k]) || 0} notes live here; ${Math.round(p.memory.today[i] || 0)} tool calls landed here today.` });
    if (P.aal) {
      const v = p.engram.a[P.aal], lvl = v ? 1 - Math.exp(-Math.max(v[0], v[1], v[2]) * p.engK() * 0.38) : 0;
      this.memorySection(el, String(P.aal), sec, row, lvl, 'What happened in this gyrus');
    }
    const dimBtn = head.createEl('button', { cls: 'cb-p-btn', text: this.dim.has(k) ? 'Show on brain' : 'Dim on brain' });
    dimBtn.addEventListener('click', () => { if (this.dim.has(k)) this.dim.delete(k); else this.dim.add(k); this.needsDraw = true; this.renderRegions(); this.renderPanel(); });
    const recs = p.history.filter(r => r.lobe === k && r.e === 'PreToolUse');
    sec('Recent activity', recs.length ? String(recs.length) : '');
    if (!recs.length) row('is-empty').setText('Nothing has happened here in the last 6 hours.');
    for (const r of recs.slice(-12).reverse()) evRow(r, true);
    const notes = this.nodes.filter(n => n.lobe === k && !n.learned).sort((m, q) => (q.firedAt || 0) - (m.firedAt || 0) || q.deg - m.deg).slice(0, 30);
    sec('Notes', String((this.counts && this.counts[k]) || 0));
    for (const n of notes) {
      const r = row('is-click'); r.createSpan({ cls: 'cb-p-x', text: n.name });
      r.createSpan({ cls: 'cb-p-t', text: n.firedAt ? fmtAgo(now - n.firedAt) + ' ago' : n.deg + (n.deg === 1 ? ' link' : ' links') });
      r.setAttr('title', n.path);
      r.addEventListener('click', () => this.app.workspace.openLinkText(n.path, '', true));
    }
    const learned = this.nodes.filter(n => n.lobe === k && n.learned).sort((m, q) => q.w - m.w).slice(0, 20);
    if (learned.length) {
      sec('Files Claude used here', String(learned.length));
      for (const n of learned) {
        const r = row('is-click cb-p-file'); r.createSpan({ cls: 'cb-p-x', text: n.proj + '/' + n.file });
        r.createSpan({ cls: 'cb-p-t', text: n.uses + '×' });
        r.setAttr('title', 'Copy path');
        r.addEventListener('click', () => { navigator.clipboard.writeText(n.file); this.flash('Path copied'); });
      }
    }
  }

  // the stored memory of one gyrus or nucleus: trace strength, then what happened there, newest first
  memorySection(el, key, sec, row, level, title) {
    const L = (this.plugin.regionMem[key] || []).slice().reverse(), now = Date.now();
    sec(title, L.length ? `trace ${Math.round(level * 100)}%` : '');
    const bar = row('cb-p-trace'); const f = bar.createDiv({ cls: 'cb-p-trace-f' }); f.style.width = Math.round(level * 100) + '%';
    bar.setAttr('title', `How strongly recent work marked this place. It halves every ${this.plugin.settings.traceMinutes || 90} minutes.`);
    if (!L.length) { row('is-empty').setText('Nothing has happened here in the last few days.'); return; }
    for (const x of L.slice(0, 14)) {
      const [t, kind, who, color, what, count, fail] = x;
      const d = row('cb-p-ev');
      d.createSpan({ cls: 'cb-p-t', text: fmtAgo(now - t) });
      const tag = d.createSpan({ cls: 'cb-p-tag', text: KIND_TAG[kind] || kind }); tag.style.color = fail ? ERR : CAT[kind] ? catColor(kind) : KIND_HEX[kind] || '#8b93a1';
      const w = d.createSpan({ cls: 'cb-p-who', text: who }); w.style.color = color;
      d.createSpan({ cls: 'cb-p-x', text: (what || '') + (count > 1 ? ` ×${count}` : '') });
    }
  }

  /* ---------- timeline and replay ---------- */

  renderTlButtons() {
    if (!this.rangeBtns) return;
    for (const b of this.rangeBtns) b.toggleClass('is-on', Number(b.dataset.m) * 60000 === this.tlRange);
    for (const b of this.speedBtns) b.toggleClass('is-on', Number(b.dataset.x) === (this.replay ? this.replay.speed : this.tlSpeed));
    this.liveBtn.toggleClass('is-on', !this.replay);
  }

  tlX2T(x) { const w = this.tlW - this.tlG - 6; const now = Date.now(); return now - this.tlRange + Math.max(0, Math.min(1, (x - this.tlG) / w)) * this.tlRange; }
  tlT2X(t) { const w = this.tlW - this.tlG - 6; return this.tlG + ((t - (Date.now() - this.tlRange)) / this.tlRange) * w; }

  bindTimeline() {
    const c = this.tlCanvas;
    this.registerDomEvent(c, 'mousemove', (e) => { const r = c.getBoundingClientRect(); this.tlHover = e.clientX - r.left; this.drawTimeline(true); });
    this.registerDomEvent(c, 'mouseleave', () => { this.tlHover = null; this.drawTimeline(true); });
    this.registerDomEvent(c, 'click', (e) => {
      const r = c.getBoundingClientRect(), x = e.clientX - r.left;
      if (x < this.tlG) return;
      this.startReplay(this.tlX2T(x), this.tlSpeed);
    });
  }

  drawTimeline(force) {
    if (!this.tlCtx || this.mini || !this.contentEl.classList.contains('cb-has-tl')) return;
    const nowP = performance.now();
    if (!force && nowP - (this.tlDrawn || 0) < 200) return;
    this.tlDrawn = nowP;
    const c = this.tlCanvas, dpr = window.devicePixelRatio || 1;
    const W = Math.max(50, c.clientWidth), H = Math.max(20, c.clientHeight);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = this.tlCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ui = this.fontUI();
    this.tlW = W; this.tlG = 104;
    const now = Date.now(), t0 = now - this.tlRange;
    const H2 = this.plugin.history;
    let i0 = H2.length; { let lo = 0, hi = H2.length; while (lo < hi) { const m = (lo + hi) >> 1; if (H2[m].t < t0) lo = m + 1; else hi = m; } i0 = lo; }
    // lanes: sessions seen in the window, in order of appearance
    const lanes = [], laneOf = new Map();
    for (let i = i0; i < H2.length; i++) { const r = H2[i]; if (!laneOf.has(r.sid)) { laneOf.set(r.sid, lanes.length); lanes.push(r); } }
    const n = Math.max(1, Math.min(5, lanes.length));
    const top = 2, axis = 12, lh = (H - top - axis) / n;
    const mono = ui;
    ctx.font = `500 10px ${mono}`; ctx.textBaseline = 'middle';
    if (!lanes.length) { ctx.fillStyle = 'rgba(140,150,168,0.6)'; ctx.fillText('No activity in this window yet. Events appear here as sessions work.', this.tlG, top + lh / 2); }
    lanes.slice(0, n).forEach((r, li) => {
      const y = top + li * lh;
      ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(this.tlG, y + 1, W - this.tlG - 6, lh - 2);
      ctx.fillStyle = r.color; ctx.globalAlpha = this.focusSid && this.focusSid !== r.sid ? 0.35 : 1;
      ctx.fillText(clip(r.label, 13), 6, y + lh / 2); ctx.globalAlpha = 1;
    });
    const lane = (sid) => Math.min(n - 1, laneOf.get(sid) || 0);
    // working spans (prompt → done) as faint bars, events as ticks coloured by region
    const open = new Map();
    for (let i = i0; i < H2.length; i++) {
      const r = H2[i];
      if (r.aid) continue;
      if (r.e === 'UserPromptSubmit') open.set(r.sid, r.t);
      else if (r.e === 'Stop' && open.has(r.sid)) { const a = open.get(r.sid); open.delete(r.sid); const li = lane(r.sid); ctx.fillStyle = r.color; ctx.globalAlpha = 0.13; ctx.fillRect(this.tlT2X(a), top + li * lh + 2, Math.max(1, this.tlT2X(r.t) - this.tlT2X(a)), lh - 4); ctx.globalAlpha = 1; }
    }
    for (const [sid, a] of open) { const li = lane(sid); const r0 = lanes[laneOf.get(sid)]; ctx.fillStyle = r0 ? r0.color : '#888'; ctx.globalAlpha = 0.13; ctx.fillRect(this.tlT2X(a), top + li * lh + 2, Math.max(1, this.tlT2X(now) - this.tlT2X(a)), lh - 4); ctx.globalAlpha = 1; }
    for (let i = i0; i < H2.length; i++) {
      const r = H2[i];
      const li = lane(r.sid), y = top + li * lh, x = Math.round(this.tlT2X(r.t)) + 0.5;
      const faded = this.focusSid && this.focusSid !== r.sid;
      if (r.e === 'PreToolUse') {
        ctx.strokeStyle = catColor(r.cat); ctx.globalAlpha = faded ? 0.25 : r.aid ? 0.55 : 0.95; ctx.lineWidth = 1;
        const pad = r.aid ? lh * 0.32 : lh * 0.18;
        ctx.beginPath(); ctx.moveTo(x, y + pad); ctx.lineTo(x, y + lh - pad); ctx.stroke();
      } else if ((r.e === 'Notification' && /permission|elicitation|needs_input/.test(r.ntype || r.text)) || r.e === 'PermissionRequest' || r.e === 'Elicitation') {
        ctx.fillStyle = WAIT; ctx.globalAlpha = faded ? 0.3 : 1;
        ctx.beginPath(); ctx.moveTo(x, y + lh / 2 - 4); ctx.lineTo(x + 4, y + lh / 2); ctx.lineTo(x, y + lh / 2 + 4); ctx.lineTo(x - 4, y + lh / 2); ctx.fill();
      } else if (r.e === 'PostToolUseFailure' || r.e === 'PermissionDenied' || r.e === 'StopFailure') {
        ctx.fillStyle = ERR; ctx.globalAlpha = faded ? 0.3 : 1; ctx.fillRect(x - 1, y + lh - 5, 2, 3);
      } else if (r.e === 'Message' || r.e === 'TaskCompleted') {
        ctx.fillStyle = r.e === 'Message' ? KIND_HEX.speak : GOLD; ctx.globalAlpha = faded ? 0.3 : 0.9;
        ctx.beginPath(); ctx.arc(x, y + lh / 2, r.e === 'Message' ? Math.min(3, 1.2 + (r.n || 0) / 1500) : 2.2, 0, Math.PI * 2); ctx.fill();
      } else if (r.e !== 'PostToolUse' && r.e !== 'UserPromptSubmit' && r.e !== 'Stop' && r.e !== 'Notification') {
        ctx.fillStyle = 'rgba(160,170,188,0.8)'; ctx.globalAlpha = faded ? 0.25 : 0.6; ctx.fillRect(x - 0.5, y + 2, 1, 3);
      }
    }
    ctx.globalAlpha = 1;
    // time axis
    const step = this.tlRange <= 15 * 60000 ? 2 * 60000 : this.tlRange <= 3600000 ? 10 * 60000 : this.tlRange <= 3 * 3600000 ? 30 * 60000 : 3600000;
    ctx.fillStyle = 'rgba(140,150,168,0.7)'; ctx.font = `9px ${mono}`; ctx.textAlign = 'center';
    for (let t = Math.ceil(t0 / step) * step; t < now; t += step) {
      const x = this.tlT2X(t);
      ctx.fillRect(x, H - axis, 1, 3);
      ctx.fillText(hhmm(t), x, H - axis / 2 + 2);
    }
    ctx.textAlign = 'left';
    // playhead / hover
    if (this.replay) {
      const x = this.tlT2X(this.replay.clock);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 0.5, 0, 1.5, H - axis);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, 0, Math.max(0, this.tlT2X(now) - x), H - axis);
    }
    if (this.tlHover != null && this.tlHover >= this.tlG) {
      const x = this.tlHover, t = this.tlX2T(x);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x, 0, 1, H - axis);
      const label = hhmm(t, true) + '  click to replay from here';
      ctx.font = `10.5px ${mono}`; const w = ctx.measureText(label).width + 8;
      const lx = Math.min(W - w - 2, x + 6);
      ctx.fillStyle = 'rgba(10,12,16,0.9)'; ctx.fillRect(lx, 1, w, 13);
      ctx.fillStyle = '#e6e9ee'; ctx.fillText(label, lx + 4, 8);
    }
    if (this.tlInfo) this.tlInfo.setText(this.replay ? `Replaying ${hhmm(this.replay.clock, true)}` : `Timeline, ${H2.length - i0} events`);
  }

  startReplay(from, speed, until) {
    if (this.mini) return;
    const h = this.plugin.history;
    let idx = 0; while (idx < h.length && h[idx].t < from) idx++;
    this.replay = { clock: from, speed: speed || this.tlSpeed, idx, until: until || null };
    this.tags = [];
    this.applyLayout();
    this.renderTlButtons();
    this.flash(`Replaying from ${hhmm(from, true)} at ${Math.round(this.replay.speed)}× speed. Esc goes back to live`);
  }

  stopReplay() {
    if (!this.replay) return;
    this.replay = null;
    this.tags = [];
    this.applyLayout();
    this.renderTlButtons();
    this.requestHud();
  }

  stepReplay(dt) {
    const r = this.replay;
    if (!r) return;
    r.clock += dt * 1000 * r.speed;
    const h = this.plugin.history;
    let n = 0;
    while (r.idx < h.length && h[r.idx].t <= r.clock && n < 30) { this.playRecord(h[r.idx]); r.idx++; n++; }
    if (n === 30 && r.idx < h.length && h[r.idx].t <= r.clock) r.clock = h[r.idx].t;   // don't skip events when the replay is very dense
    if (r.clock >= (r.until || Date.now()) || r.idx > h.length) this.stopReplay();
    else this.drawTimeline();
  }

  playRecord(r) {
    const s = { id: r.sid, color: r.color, label: r.label, project: r.label, idx: r.idx || 0, src: r.src,
      wait: r.e === 'Notification' && /permission|elicitation|needs_input/.test(r.ntype || r.text) ? { kind: 'approval' } : null };
    const a = r.aid ? { id: r.aid, type: r.agent, tools: 0, wf: r.wf } : null;
    const ev = { hook_event_name: r.e, tool_name: r.tool, tool_input: r.file ? { file_path: r.file } : {}, cwd: r.cwd, message: r.text, _cat: r.cat };
    if (r.aid) ev.agent_id = r.aid;
    this.onBrainEvent(ev, s, a, { replay: true, t: r.t, text: r.text }, r, null);
  }

  scheduleRebuild(delay) {
    if (this.learnTimer) window.clearTimeout(this.learnTimer);
    this.learnTimer = window.setTimeout(() => { this.learnTimer = null; this.buildGraph(); }, delay == null ? 1500 : delay);
  }

  /* ---------- HUD ---------- */

  renderLog() {
    if (!this.logEl) return;
    this.logEl.empty();
    for (const l of this.log.slice().reverse()) {
      const row = this.logEl.createDiv({ cls: 'cb-log-row' + (l.file || l.abs ? ' is-click' : '') + (l.replay ? ' is-replay' : '') });
      row.createSpan({ cls: 'cb-log-t', text: hhmm(l.t, true) });
      if (l.file) { row.setAttr('title', 'Open ' + l.file); row.addEventListener('click', () => this.app.workspace.openLinkText(l.file, '', true)); }
      else if (l.abs) { row.setAttr('title', 'Copy path: ' + l.abs); row.addEventListener('click', () => { navigator.clipboard.writeText(l.abs); this.flash('Path copied'); }); }
      const dot = row.createSpan({ cls: 'cb-log-dot' });
      dot.style.background = l.color;
      dot.setAttr('title', cap(l.tag.toLowerCase()));
      if (l.proj) { const p = row.createSpan({ cls: 'cb-log-proj', text: l.proj }); p.style.color = l.pcolor; }
      row.createSpan({ cls: 'cb-log-x', text: l.text });
      if (l.region) row.createSpan({ cls: 'cb-log-r', text: l.region });
    }
  }

  renderRegions() {
    if (!this.regionsEl) return;
    this.regionsEl.empty();
    const h = this.regionsEl.createDiv({ cls: 'cb-regions-h' });
    h.createSpan({ text: 'Regions' });
    h.createSpan({ cls: 'cb-regions-h2', text: 'today' });
    this.meters = {};
    for (const k of LOBE_ORDER) {
      const row = this.regionsEl.createDiv({ cls: 'cb-region' + (this.dim.has(k) ? ' is-dim' : '') });
      const sw = row.createSpan({ cls: 'cb-swatch' });
      sw.style.background = LOBES[k].color;
      const body = row.createDiv({ cls: 'cb-region-body' });
      body.createDiv({ cls: 'cb-region-name', text: cap(LOBES[k].label.toLowerCase()) });
      body.createDiv({ cls: 'cb-region-fn', text: LOBES[k].fn.replace(' · ', ', ') });
      const meter = row.createDiv({ cls: 'cb-meter' });
      const bar = meter.createDiv({ cls: 'cb-meter-bar' });
      const fill = bar.createDiv({ cls: 'cb-meter-fill' });
      fill.style.background = LOBES[k].color;
      const n = meter.createSpan({ cls: 'cb-meter-n', text: '0' });
      row.setAttr('title', `${(this.counts && this.counts[k]) || 0} notes. Bar: memory trace (fades by half every 2 h). Number: tool calls in this region today. Click for details.`);
      this.meters[k] = { fill, n };
      row.addEventListener('click', () => this.togglePanel({ kind: 'region', id: k }));
    }
    this.updateMeters();
  }

  updateMeters() {
    if (!this.meters) return;
    const lv = this.plugin.traceLevels(), today = this.plugin.memory.today;
    LOBE_ORDER.forEach((k, i) => {
      const m = this.meters[k]; if (!m) return;
      m.fill.style.width = Math.round(lv[i] * 100) + '%';
      m.n.setText(String(Math.round(today[i] || 0)));
    });
    const on = this.plugin.settings.memoryTrace;
    this.traceOn = on && lv.some(v => v > 0.01);
    if (!this.regions) return;
    let j = 0;
    ['frontal', 'motor', 'parietal', 'temporal', 'occipital', 'cerebellum'].forEach((k) => {
      const i = LOBE_ORDER.indexOf(k), c = col3(LOBES[k].color), v = on ? lv[i] : 0;
      for (const side of ['L', 'R']) {
        const r = this.regions[k + side], a = r && (r.surf || r);
        if (a) this.traceP[j].set(a.x, a.y, a.z, k === 'cerebellum' ? 24 : 30);
        this.traceC[j].set(c.r * v, c.g * v, c.b * v);
        j++;
      }
    });
  }

  renderHud() {
    if (!this.chipEl) return;
    const p = this.plugin, now = Date.now();
    const list = p.activeSessions();
    const waiting = list.filter(s => s.wait && s.wait.kind === 'approval');
    const working = list.filter(s => p.isLive(s));
    const down = [...p.sources.values()].filter(x => p.sourceState(x) === 'down');

    // header: dots per session, then one short status in plain words
    this.headDots.empty();
    for (const s of list) {
      const d = this.headDots.createSpan({ cls: 'cb-hdot' + (s.wait && s.wait.kind === 'approval' ? ' is-wait' : p.isLive(s) ? ' is-live' : '') });
      d.style.setProperty('--sc', s.color);
    }
    this.chipEl.empty();
    this.chipEl.className = 'cb-chip' + (!p.serverOk || down.length || waiting.length ? ' is-warn' : '');
    this.chipEl.setText(!p.serverOk ? 'not listening'
      : down.length ? `${down.map(x => x.name).join(', ')} tunnel down`
      : waiting.length ? `${waiting.length} waiting for you`
      : list.some(s => s.alarm) ? `${list.filter(s => s.alarm).length} may be stuck`
      : working.length ? `${working.length} working`
      : this.dream ? 'idle · dreaming' : list.length ? 'idle' : 'listening');
    if (this.dream) this.chipEl.setAttr('title', `Nothing is running, so the brain replays the work from ${hhmm(this.dream.from)} to ${hhmm(this.dream.to)}, the way the hippocampus replays the day in sleep.`);
    this.chipEl.setAttr('title', p.serverOk ? `Listening for Claude Code hooks on 127.0.0.1:${p.settings.port}` : `Could not open port ${p.settings.port}; change it in settings.`);

    // sessions: one line each. Click one for its details.
    this.sessionsEl.empty();
    if (!list.length) this.sessionsEl.createDiv({ cls: 'cb-empty', text: p.serverOk ? 'Sessions show up here when Claude Code starts.' : 'The listener is off.' });
    for (const s of list) {
      const approval = s.wait && s.wait.kind === 'approval';
      const reply = s.wait && s.wait.kind === 'input';
      const live = p.isLive(s);
      const row = this.sessionsEl.createDiv({ cls: 'cb-s' + (approval ? ' is-wait' : s.alarm ? ' is-alarm' : live ? ' is-live' : reply ? ' is-reply' : '') + (this.focusSid && s.id !== this.focusSid ? ' is-faded' : '') + (s.id === this.focusSid ? ' is-focus' : '') });
      row.style.setProperty('--sc', s.color);
      row.setAttr('title', s.id === this.focusSid ? 'Show all sessions' : 'Details for this session');
      row.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFocus(s.id); });
      row.createSpan({ cls: 'cb-s-dot' });
      row.createSpan({ cls: 'cb-s-name', text: p.sessionLabel(s) });
      const agents = p.runningAgents(s).length;
      const pl = p.plan(s);
      let what = approval ? 'needs you' : s.alarm ? 'may be stuck' : reply ? 'your turn' : s.state;
      if (s.alarm) row.setAttr('title', s.alarm.text);
      if (live && agents) what += `, ${agents} agent${agents > 1 ? 's' : ''}`;
      row.createSpan({ cls: 'cb-s-state', text: what });
      if (pl && !this.mini) row.createSpan({ cls: 'cb-s-plan', text: `${pl.done}/${pl.total}` }).setAttr('title', `${pl.done} of ${pl.total} tasks done. Now: ${pl.current}`);
      const t = approval || reply ? now - s.wait.since : live ? now - s.since : now - s.at;
      row.createSpan({ cls: 'cb-s-time', text: live || approval ? fmtDur(t) : fmtAgo(t) });
    }

    // body signals: one quiet line per machine (CPU trend, CPU, memory, traffic)
    if (p.settings.showVitals && !this.mini) {
      const vs = p.freshVitals();
      vs.forEach((x, i) => {
        const row = this.sessionsEl.createDiv({ cls: 'cb-vit' + (i === 0 ? ' is-first' : '') });
        row.createSpan({ cls: 'cb-vit-name', text: x.name === 'local' ? 'this PC' : x.name });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'cb-vit-spark'); svg.setAttribute('viewBox', '0 0 60 14'); svg.setAttribute('preserveAspectRatio', 'none');
        const h = x.hist || [], pts = h.map((v, j) => `${(j / Math.max(1, h.length - 1) * 60).toFixed(1)},${(13 - Math.min(1, v) * 12).toFixed(1)}`).join(' ');
        const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        pl.setAttribute('points', pts || '0,13 60,13'); svg.appendChild(pl); row.appendChild(svg);
        const pct = (v) => Math.round((v || 0) * 100) + '%';
        const t = `cpu ${pct(x.cpu)}  mem ${pct(x.mem)}`;
        row.setAttr('title', `${x.name === 'local' ? 'This computer' : x.name}: CPU ${pct(x.cpu)}, memory ${pct(x.mem)}` + (x.rx != null ? `, network ${fmtRate(x.rx)} in / ${fmtRate(x.tx)} out, disk ${fmtRate(x.rd)} read / ${fmtRate(x.wr)} written` : '') + '. The brain stem beats with the CPU load of the machine Claude is working on.');
        row.createSpan({ cls: 'cb-vit-v' + (x.mem > 0.88 || x.cpu > 0.9 ? ' is-hot' : ''), text: t });
      });
    }

    // approvals: the one thing that always shows
    this.bannerEl.empty();
    const alarmed = list.filter(s => s.alarm && !(s.wait && s.wait.kind === 'approval'));
    this.bannerEl.toggleClass('is-on', waiting.length > 0 || alarmed.length > 0);
    for (const s of alarmed) {
      const b = this.bannerEl.createDiv({ cls: 'cb-banner-row is-alarm' });
      b.style.setProperty('--sc', s.color);
      b.createSpan({ cls: 'cb-banner-dot' });
      const txt = b.createSpan({ cls: 'cb-banner-msg' });
      txt.createSpan({ cls: 'cb-banner-proj', text: p.sessionLabel(s) });
      txt.appendText(' may be stuck: ' + clip(s.alarm.text, 70));
      const x = b.createSpan({ cls: 'cb-banner-x', text: '×' });
      x.setAttr('title', 'Dismiss');
      x.addEventListener('click', (e) => { e.stopPropagation(); p.clearAlarm(s); });
      b.addEventListener('click', () => this.toggleFocus(s.id));
    }
    for (const s of waiting) {
      const b = this.bannerEl.createDiv({ cls: 'cb-banner-row' });
      b.style.setProperty('--sc', s.color);
      b.createSpan({ cls: 'cb-banner-dot' });
      const txt = b.createSpan({ cls: 'cb-banner-msg' });
      txt.createSpan({ cls: 'cb-banner-proj', text: p.sessionLabel(s) });
      const tool = (s.wait.msg || '').replace(/^Claude (Code )?needs your permission to (use |run )?/i, '');
      txt.appendText(tool && tool !== s.wait.msg ? ` wants to use ${clip(tool, 40)}` : ' needs your approval');
      b.createSpan({ cls: 'cb-banner-t', text: fmtDur(now - s.wait.since) });
      b.addEventListener('click', () => this.toggleFocus(s.id));
    }
    this.captionEl.toggleClass('is-hidden', true);

    // info popover (only rendered while open)
    if (this.infoEl && this.infoEl.classList.contains('is-on')) {
      this.kpiEl.empty();
      const fps = this.ft && this.lastFrameAt && performance.now() - this.lastFrameAt < 500 ? Math.round(1000 / this.ft) : null;
      const lc = this.learnedCounts || { neurons: 0, synapses: 0 };
      const kpi = (v, label, plus, title) => {
        const d = this.kpiEl.createDiv({ cls: 'cb-kpi' });
        d.createSpan({ cls: 'cb-kpi-v', text: v === null ? '–' : Number(v).toLocaleString('en-US') });
        if (plus) d.createSpan({ cls: 'cb-kpi-plus', text: '+' + plus.toLocaleString('en-US') });
        d.createSpan({ cls: 'cb-kpi-k', text: label });
        if (title) d.setAttr('title', title);
      };
      kpi(this.nodes.length - lc.neurons, 'neurons', lc.neurons, 'Notes in your vault, plus files Claude has worked with (they fade over a few days when unused).');
      kpi(this.links.length - lc.synapses, 'synapses', lc.synapses, 'Links between your notes, plus connections learned from files Claude used one after another.');
      kpi(p.eventsPerMinute(), 'events a minute');
      const tt = p.tokensToday();
      if (tt.in || tt.out) {
        const d = this.kpiEl.createDiv({ cls: 'cb-kpi' });
        d.createSpan({ cls: 'cb-kpi-v', text: fmtTok(tt.in + tt.out) }); d.createSpan({ cls: 'cb-kpi-k', text: 'tokens today' });
        d.setAttr('title', `${fmtTok(tt.in)} in (context, mostly from cache), ${fmtTok(tt.out)} out. From Claude Code's own telemetry.`);
        const c = this.kpiEl.createDiv({ cls: 'cb-kpi' });
        c.createSpan({ cls: 'cb-kpi-v', text: '$' + tt.cost.toFixed(2) }); c.createSpan({ cls: 'cb-kpi-k', text: 'cost today' });
        c.setAttr('title', 'The cost Claude Code reports for these model calls (an estimate at API prices).');
      }
      kpi(fps, 'fps', 0, `Render scale ${this.qualityScale().toFixed(2)}x.`);
      this.srcEl.empty();
      for (const x of [...p.sources.values()].sort((m, n) => (m.name === 'local' ? 0 : 1) - (n.name === 'local' ? 0 : 1))) {
        const st = p.sourceState(x);
        const c = this.srcEl.createDiv({ cls: 'cb-src is-' + st });
        c.createSpan({ cls: 'cb-src-dot' });
        c.createSpan({ cls: 'cb-src-name', text: x.name === 'local' ? 'This computer' : x.name });
        c.createSpan({ cls: 'cb-src-st', text: st === 'up' ? 'tunnel up' : st === 'down' ? `tunnel down ${fmtAgo(now - x.lastBeat)}` : x.lastEvent ? `last event ${fmtAgo(now - x.lastEvent)} ago` : 'connected' });
      }
      if (!p.sources.size) this.srcEl.createDiv({ cls: 'cb-src', text: 'No machine has reported in yet.' });
    }
    this.updateMeters();
  }

  /* ---------- loop ---------- */

  loop(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt0 = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const dt = this.frozen ? 0 : dt0 * (this.timeScale || 1);   // frozen: nothing travels, but you can still turn the brain around
    this.simT = (this.simT || 0) + dt;
    const idle = now - this.lastInteract > 5000;
    const following = !this.frozen && this.followCamera(dt, now);
    const rotating = !this.frozen && !following && this.plugin.settings.autoRotate && idle;
    if (rotating) this.view.yaw += dt * 0.08;
    if (this.replay && !this.frozen) this.stepReplay(dt);
    this.update(dt);
    if (!this.canvas || !this.visible || document.hidden) { this.lastFrameAt = 0; return; }
    const interacting = now - this.lastInteract < 400;
    const moving = rotating || following || interacting || this.needsDraw || this.hover || this.replay || (this.tractSpikes && this.tractSpikes.length) || (this.inner && this.inner.some(it => it.act > 0.01)) ||
      this.spikes.length || this.pulses.length || this.waves.length || this.pings.length || this.tags.length ||
      (now - this.lastActivity) < 4000 || this.plugin.anyLive() || !!this.dream || now - this.lastDraw > 1000;
    if (!moving) { this.lastFrameAt = 0; return; }
    // battery mode: every other frame, so the cadence stays even instead of alternating 33/50 ms
    this.frameN = (this.frameN + 1) | 0;
    if (this.plugin.settings.fps === 30 && !interacting && (this.frameN & 1)) return;
    this.lastDraw = now;
    this.needsDraw = false;
    this.draw();
    this.drawEeg();
    this.trackFrame(now);
  }

  // camera follows the most active lobe; hands control back after you drag, and resumes auto-rotate when things go quiet
  followCamera(dt, now) {
    if (!this.plugin.settings.follow || !this.regions) { this.focus = null; return false; }
    if (now - this.lastInteract < 8000) { this.focus = null; this.focusAt = now; return false; }
    let best = null, bv = 0.35;
    for (const l in this.attn) if (this.attn[l] > bv) { bv = this.attn[l]; best = l; }
    if (best !== this.focus && now - this.focusAt > 3500) {
      if (!this.focus || !best || bv > (this.attn[this.focus] || 0) * 1.3) {
        this.focus = best; this.focusAt = now;
        if (best) {
          const L = this.regions[best + 'L'], R = this.regions[best + 'R'];
          const dl = L ? Math.abs(angDiff(Math.atan2(L.x, L.z), this.view.yaw)) : 9, dr = R ? Math.abs(angDiff(Math.atan2(R.x, R.z), this.view.yaw)) : 9;
          this.focusSide = dl <= dr ? L : R;
        }
      }
    }
    const r = this.focus && this.focusSide;
    if (!r) return false;
    const len = Math.hypot(r.x, r.y + 6, r.z) || 1;
    const ty = Math.atan2(r.x, r.z) + 0.12 * Math.sin(now / 4200);
    const tp = Math.max(-0.25, Math.min(0.55, Math.asin((r.y + 6) / len) * 0.6 + 0.15));
    const e = 1 - Math.exp(-dt * 0.8);
    this.view.yaw += angDiff(ty, this.view.yaw) * e;
    this.view.pitch += (tp - this.view.pitch) * e;
    return true;
  }

  update(dt) {
    if (!dt) return;
    for (const n of this.nodes) { if (n.act > 0) n.act = Math.max(0, n.act - dt * 0.6); if (n.labelT > 0) n.labelT -= dt; }
    const cur = this.spikes; this.spikes = [];
    for (const s of cur) { s.t += dt * s.speed; if (s.t >= 1) this.fire(s.b, s.hex, s.str, s.depth, s.a, undefined, s.src); else this.spikes.push(s); }
    this.pulses = this.pulses.filter(p => (p.t += dt) < p.life);
    this.waves = this.waves.filter(w => (w.r += dt * 95) < 170);
    this.pings = this.pings.filter(p => (p.t += dt) < 1.2);
    this.tags = this.tags.filter(t => (t.t += dt) < 4.5);
    if (this.inner) {
      const waiting = [...this.plugin.sessions.values()].some(s2 => s2.wait && s2.wait.kind === 'approval');
      const alarmed = !waiting && [...this.plugin.sessions.values()].some(s2 => s2.alarm);
      for (const it of this.inner) {
        it.act = Math.max(0, it.act - dt * 0.55);
        if (waiting && it.name === 'Amygdala') { const k = 0.35 + 0.25 * Math.sin(this.simT * 1000 / 260); if (k > it.act) { it.act = k; it.actColor.set(WAIT); } }
        else if (alarmed && it.name === 'Amygdala') { const k = 0.3 + 0.2 * Math.sin(this.simT * 1000 / 320); if (k > it.act) { it.act = k; it.actColor.set(ERR); } }
      }
    }
    if (this.tractSpikes && this.tractSpikes.length) {
      const done = [];
      this.tractSpikes = this.tractSpikes.filter(sp => ((sp.t += dt * sp.speed) < 1) || (sp.onEnd && done.push(sp.onEnd), false));
      for (const f of done) { try { f(); } catch (e) { console.error('[agent-brain]', e); } }
    }
    this.ongoing(dt);
    this.vitalSigns(dt);
    this.dreamTick(dt);
    this.eegStep(dt);
    const k = Math.exp(-dt / 5);
    for (const l in this.attn) this.attn[l] *= k;
    for (const s of this.plugin.sessions.values()) {
      if (!this.plugin.isLive(s)) continue;
      if (s.phase === 'thinking') this.attend('frontal', dt * 0.03);
      else if (s.phase === 'tool') this.attend(s.toolLobe, dt * 0.12);
    }
    for (const s of this.plugin.sessions.values()) if (s.workflow && s.workflow.active) this.attend('parietal', dt * 0.08);
    if (!this.plugin.settings.ambient) return;
    this.ambientT -= dt;
    if (this.ambientT <= 0 && this.nodes.length) {
      this.ambientT = this.plugin.anyBusy() ? 0.3 : 2.4;
      this.fire(this.nodes[Math.floor(Math.random() * this.nodes.length)], SIGNAL, 0.3, 2, null);
    }
  }

  // a model call finished: its metabolic cost shows the way fMRI shows it, a slow, broad, warm response a moment
  // later (the haemodynamic lag), bigger with more output; tokens read back from cache light the hippocampus (recall)
  onMetabolism(s, m) {
    if (!this.scene || this.replay || !this.gyrusAnchor) return;
    if (s && this.focusSid && s.id !== this.focusSid) return;
    if (this.dream) this.stopDream();
    this.lastActivity = performance.now();
    const amp = Math.min(0.5, 0.06 + Math.log10(1 + (m.out || 0)) * 0.11);
    const pool = m.agent ? GYRI.agent : GYRI.think;
    const sites = shuffled(pool, 2).map(l => this.gyrusAnchor[l]).filter(Boolean);
    window.setTimeout(() => { for (const g of sites) this.pulse(g, BOLD, amp, 24, 8, 2.4); }, 1200);
    if (m.cr > 0) this.innerAct('Hippocampus', '#c9b8ff', Math.min(0.55, 0.08 + Math.log10(1 + m.cr) * 0.08));
    if (m.inT > 0) this.pulse(THALAMUS, '#e6eeff', Math.min(0.3, 0.05 + Math.log10(1 + m.inT) * 0.06), 8, 1.4);
  }
  onApiError(s) {
    if (!this.scene || this.replay) return;
    this.pulse(STEM, ERR, 0.35, 10, 1.8);
    this.innerAct('Amygdala', ERR, 0.7);
  }
  onAlarm(s) {
    if (!this.scene || !s || !s.alarm) return;
    for (const l of GYRI.alarm.slice(0, 2)) { const g = this.gyrusAnchor[l]; if (g) this.pulse(g, ERR, 0.5, 10, 2.4); }
    this.innerAct('Amygdala', ERR, 0.9);
  }

  /* ---------- sleep: when nothing runs for a while, the brain replays the last hours of work ---------- */

  dreamTick(dt) {
    const P = this.plugin, st = P.settings, now = Date.now();
    if (this.dream) {
      if (!st.dream || this.replay || P.anyLive()) { this.stopDream(); return; }
      const D = this.dream;
      D.wave -= dt;
      if (D.wave <= 0) { D.wave = 1.7 + Math.random() * 0.8; this.wave({ x: 0, y: THALAMUS.y, z: THALAMUS.z }, DREAM, 0.14); }   // slow waves
      if (D.pause > 0) { D.pause -= dt; if (D.pause <= 0) { D.i = 0; D.clock = D.list[0][0]; } return; }
      D.clock += dt * D.speed;
      let n = 0;
      while (D.i < D.list.length && D.list[D.i][0] <= D.clock && n < 3) { this.dreamStrike(D.list[D.i]); D.i++; n++; }
      if (D.i >= D.list.length) D.pause = 14;
      return;
    }
    if (!st.dream || this.mini || this.replay || P.anyLive()) return;
    if (now - (P.lastRealEvent || P.loadedAt || 0) < 3 * 60000 || now - this.lastInteract < 30000) return;
    this.dreamCheck = (this.dreamCheck || 0) - dt;
    if (this.dreamCheck > 0) return;
    this.dreamCheck = 15;
    const list = [];
    for (const [key, L] of Object.entries(P.regionMem)) {
      if (key.startsWith('n:')) continue;
      for (const x of L) if (x[0] > now - 6 * 3600000) list.push([x[0], Number(key), x[1], x[3], x[6]]);
    }
    if (list.length < 6) return;
    list.sort((a, b) => a[0] - b[0]);
    const L2 = list.slice(-360), span = Math.max(1, L2[L2.length - 1][0] - L2[0][0]);
    this.dream = { list: L2, i: 0, clock: L2[0][0], speed: span / 50, pause: 0, wave: 0, from: L2[0][0], to: L2[L2.length - 1][0] };
    this.requestHud();
  }
  dreamStrike(x) {
    const [, label, kind, color, fail] = x;
    const st = { kind, label, w: 0, hex: fail ? ERR : CAT[kind] ? catColor(kind) : KIND_HEX[kind] || SIGNAL, nucleus: NUCLEUS[kind] || KIND_NUCLEUS[kind] || null, fibre: this.plugin.fibreFor(kind, label, label) };
    this.strike(st, color || DREAM, 0.5, 0, { amp: 0.42, sigma: 9, life: 2.2, src: { type: 'dream', t: x[0], st, color } });
  }
  stopDream() { if (!this.dream) return; this.dream = null; this.requestHud(); }

  /* ---------- EEG-style traces: one line per region, driven by what actually lands there ---------- */

  eegFeed(pos, amp) {
    if (!this.eeg || !this.regions) return;
    let best = null, bd = Infinity;
    for (const l of EEG_CH) for (const side of ['L', 'R']) {
      const r = this.regions[l + side]; if (!r) continue;
      const d = (r.x - pos.x) ** 2 + (r.y - pos.y) ** 2 + (r.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = l; }
    }
    if (best && bd < 70 * 70) this.eeg.kick[EEG_CH.indexOf(best)] += amp;
  }
  eegStep(dt) {
    const E = this.eeg; if (!E) return;
    const P = this.plugin;
    let state = 'alpha';
    if (this.dream) state = 'delta';
    else for (const s of P.sessions.values()) { if (!P.isLive(s)) continue; if (s.phase === 'thinking' || s.phase === 'compacting') { state = 'gamma'; break; } state = 'beta'; }
    E.state = state;
    const R = EEG_RHYTHM[state], rate = 40;
    E.acc += dt * rate;
    while (E.acc >= 1) {
      E.acc -= 1; E.t += 1 / rate;
      for (let c = 0; c < EEG_CH.length; c++) {
        E.env[c] = E.env[c] * 0.86 + Math.min(1.5, E.kick[c]) * 0.6; E.kick[c] = 0;
        const g = state === 'alpha' && EEG_CH[c] === 'occipital' ? 1.8 : 1;       // alpha is strongest at the back of the head
        let v = R.a * g * Math.sin(2 * Math.PI * R.f * E.t + c * 1.3) + (Math.random() - 0.5) * 0.12;
        v += E.env[c] * (Math.sin(2 * Math.PI * 7 * E.t + c) * 0.9 - 0.5);      // an event: a sharp evoked burst
        E.buf[c][E.pos] = v;
      }
      E.pos = (E.pos + 1) % EEG_N;
    }
  }
  drawEeg() {
    const E = this.eeg, cv = this.eegCanvas;
    if (!E || !cv || !this.eegEl || !this.eegEl.offsetParent) return;
    const now = performance.now();
    if (now - (E.drawn || 0) < 33) return;
    E.drawn = now;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = this.eegCtx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const lh = H / EEG_CH.length, x0 = 20, w = W - x0 - 4;
    ctx.font = `9px ${this.fontUI()}`; ctx.textBaseline = 'middle';
    for (let c = 0; c < EEG_CH.length; c++) {
      const mid = lh * (c + 0.5);
      ctx.fillStyle = LOBES[EEG_CH[c]].color; ctx.globalAlpha = 0.75; ctx.fillText(EEG_LABEL[c], 2, mid);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = 'rgba(205,215,232,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < EEG_N; i++) {
        const v = E.buf[c][(E.pos + i) % EEG_N];
        const x = x0 + (i / (EEG_N - 1)) * w, y = mid - Math.max(-1.6, Math.min(1.6, v)) * lh * 0.3;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.eegStateEl && this.eegStateEl.textContent !== EEG_RHYTHM[E.state].name) this.eegStateEl.setText(EEG_RHYTHM[E.state].name);
  }

  // what keeps running between events, so the brain never sits still while Claude works:
  // thinking = prefrontal loops firing; a long tool call = the pathway to its region kept busy; compaction = hippocampal ripples
  ongoing(dt) {
    if (!this.tractLines || !this.tractLines.length || this.replay) return;
    const P = this.plugin, G = P.geo;
    let thinkers = 0;
    for (const s of P.sessions.values()) {
      if (!P.isLive(s) && s.phase !== 'compacting') continue;
      if (s.wait && s.wait.kind === 'approval') continue;
      const k = this.focusSid && s.id !== this.focusSid ? 0.18 : 1;
      if (s.phase === 'thinking') thinkers++;
      s._ot = (s._ot || 0) - dt;
      if (s._ot > 0) continue;
      const sc = s.color || SIGNAL;
      if (s.phase === 'thinking') {
        s._ot = 0.12 + Math.random() * 0.2;
        const f = P.fibreAny('think');
        if (!f) continue;
        const l = this.tractLines[f.i], back = Math.random() < 0.5;
        this.signal(f, sc, 0.7 * k, () => {
          const p = this.tractPoint(l, (back ? !f.toEnd : f.toEnd) ? 1 : 0, { x: 0, y: 0, z: 0 });
          this.pulse(p, sc, 0.22 * k, 6, 0.9);
        }, back, 150 + Math.random() * 60, { type: 'think', sid: s.id, color: sc });
        s._oc = ((s._oc || 0) + 1) % 5;
        if (!s._oc) { this.innerAct('Caudate nucleus', sc, 0.32 * k); this.innerAct('Thalamus', sc, 0.22 * k); }
        // and the prefrontal surface twinkles: a different patch each time
        const g = this.gyrusAnchor[GYRI.think[Math.floor(Math.random() * GYRI.think.length)]];
        if (g) this.pulse(g, sc, 0.2 * k, 7, 0.9);
      } else if (s.phase === 'tool') {
        // the command is still running: keep its pathway busy, a little stronger the longer it takes
        s._ot = 0.42 + Math.random() * 0.2;
        const st = s.lastStrikes && s.lastStrikes[Math.floor(Math.random() * s.lastStrikes.length)];
        if (!st) continue;
        const long = Math.min(1, (Date.now() - s.since) / 20000);
        this.strike(st, sc, (0.35 + 0.35 * long) * k, 0, { amp: 0.32, sigma: 8, life: 1.2, nucleus: false, speed: 130, src: { type: 'running', sid: s.id, color: sc, st, rec: s.lastPre } });
      } else if (s.phase === 'compacting') {
        s._ot = 0.25 + Math.random() * 0.15;
        const g = this.gyrusAnchor[P.labelFor('memory', Math.floor(Math.random() * 4))];
        this.signalNear('memory', g || THALAMUS, '#c9b8ff', 0.7 * k, () => this.innerAct('Hippocampus', '#c9b8ff', 0.5 * k), Math.random() < 0.5, undefined, { type: 'compact', sid: s.id, color: '#c9b8ff' });
      }
    }
    // a running workflow: agents keep the parietal network busy
    for (const s of P.sessions.values()) {
      if (!s.workflow || !s.workflow.active) continue;
      const n = P.runningAgents(s).length;
      if (!n) continue;
      s._wt = (s._wt || 0) - dt;
      if (s._wt > 0) continue;
      s._wt = Math.max(0.15, 0.7 / Math.min(n, 6));
      this.signalNear('agent', (this.regions[Math.random() < 0.5 ? 'parietalL' : 'parietalR'] || {}).surf || THALAMUS, s.color || SIGNAL, 0.55, null, Math.random() < 0.5, undefined, { type: 'workflow', sid: s.id, color: s.color });
    }
    this.thinkers = thinkers;
    if (G) P.engRebase();
  }

  // the machine's own state, read by the brain stem: heartbeat follows CPU load, network traffic rises along the
  // sensory pathways, disk work runs through the cerebellar peduncles, memory pressure shows in the ventricles
  vitalSigns(dt) {
    const P = this.plugin;
    if (!P.settings.showVitals || !this.regions || this.replay) { this.vitalLevel = 0; return; }
    const V = P.vitalsNow();
    if (!V) { this.vitalLevel = 0; return; }
    this.vitalLevel = V.mem;
    const bpm = 50 + 110 * Math.min(1, V.cpu);
    this.beatT = (this.beatT || 0) - dt;
    if (this.beatT <= 0) {
      this.beatT = 60 / bpm;
      const a = 0.08 + 0.3 * Math.min(1, V.cpu);
      this.pulse(STEM, VITAL, a, 7, 0.55);
      window.setTimeout(() => this.pulse(STEM, VITAL, a * 0.55, 6, 0.45), 170);      // lub-dub
      if (V.cpu > 0.35 && Math.random() < V.cpu) this.signalUp('arouse', VITAL, 0.35 + 0.4 * V.cpu, null, false, 120, { type: 'body', what: 'cpu', machine: V.name });
    }
    // traffic: one ascending spike per decade of bytes/s above 10 kB/s, each second
    const rate = (b) => b > 1e4 ? Math.min(6, Math.log10(b / 1e4) + 1) : 0;
    this.netT = (this.netT || 0) - dt * rate(V.net);
    if (this.netT <= 0 && V.net > 1e4) { this.netT = 1; this.signalUp('body', VITAL, 0.45, null, Math.random() < 0.4, 160, { type: 'body', what: 'net', machine: V.name }); }
    this.diskT = (this.diskT || 0) - dt * rate(V.disk);
    if (this.diskT <= 0 && V.disk > 1e4) { this.diskT = 1; this.signalNear('ops', (this.regions.cerebellumL || {}).surf || STEM, VITAL, 0.4, null, Math.random() < 0.5, 160, { type: 'body', what: 'disk', machine: V.name }); }
  }

  // real state, not decoration: a slow glow per session while the model is thinking (frontal),
  // while a tool is running (that tool's lobe), or while it waits for your approval (amber)
  breaths() {
    const out = [], t = this.simT || 0;
    if (!this.regions || this.replay) return out;
    for (const s of this.plugin.sessions.values()) {
      if (this.focusSid && s.id !== this.focusSid) continue;
      const approval = s.wait && s.wait.kind === 'approval';
      if (!approval && !this.plugin.isLive(s)) continue;
      let lobe, hex = s.color, amp, hz;
      if (approval) { lobe = 'frontal'; hex = WAIT; amp = 0.42; hz = 0.8; }
      else if (s.phase === 'thinking') { lobe = 'frontal'; amp = 0.2; hz = 0.45; }
      else if (s.phase === 'tool') { lobe = s.toolLobe; amp = 0.24; hz = 0.6; }
      else continue;
      const k = amp * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz + s.idx * 2.1)));
      const c = s._c && s._ch === hex ? s._c : (s._c = col3(hex), s._ch = hex, s._c);
      for (const side of ['L', 'R']) {
        const r = this.regions[lobe + side];
        if (!r || !r.anchors) continue;
        const a = r.anchors[s.idx % r.anchors.length];
        out.push([{ x: a.x, y: a.y, z: a.z, sigma: 17, c }, k]);
      }
      if (out.length >= 12) break;
    }
    // a session that may be stuck: the anterior cingulate (error and conflict monitoring) keeps pulsing red
    for (const s of this.plugin.sessions.values()) {
      if (!s.alarm || out.length >= 16) continue;
      if (this.focusSid && s.id !== this.focusSid) continue;
      const k = 0.3 * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.7)));
      const c = this._errC || (this._errC = col3(ERR));
      for (const l of GYRI.alarm.slice(0, 2)) { const g = this.gyrusAnchor && this.gyrusAnchor[l]; if (g) out.push([{ x: g.x, y: g.y, z: g.z, sigma: 12, c }, k]); }
    }
    // working memory: how full each live session's context is, as a steady load on dorsolateral prefrontal cortex
    for (const s of this.plugin.sessions.values()) {
      if (!this.plugin.isLive(s) || out.length >= 18) continue;
      if (this.focusSid && s.id !== this.focusSid) continue;
      const M = this.plugin.metab.get(s.id);
      if (!M || !M.ctx) continue;
      const fill = Math.min(1, M.ctx / ctxLimit(M));
      const c = this._boldC || (this._boldC = col3(BOLD));
      const g = this.gyrusAnchor && this.gyrusAnchor[GYRI.exec[(s.idx || 0) % 2]];
      if (g) out.push([{ x: g.x, y: g.y, z: g.z, sigma: 20, c }, 0.04 + 0.16 * fill]);
    }
    // a running workflow keeps the parietal "agents" area humming, stronger with more agents at work
    for (const s of this.plugin.sessions.values()) {
      if (!s.workflow || !s.workflow.active || out.length >= 14) continue;
      if (this.focusSid && s.id !== this.focusSid) continue;
      const n = this.plugin.runningAgents(s).filter(a => a.wf).length;
      if (!n) continue;
      const k = (0.12 + 0.035 * Math.min(n, 8)) * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.5 + s.idx)));
      const c = s._wc || (s._wc = col3(s.color));
      for (const side of ['L', 'R']) {
        const r = this.regions['parietal' + side];
        if (!r || !r.anchors) continue;
        const a = r.anchors[(s.idx + 1) % r.anchors.length];
        out.push([{ x: a.x, y: a.y, z: a.z, sigma: 20, c }, k]);
      }
    }
    return out;
  }

  // the look (anatomy or atlas), eased between the two so switching is a short crossfade
  lookParams() {
    const want = this.plugin.settings.look === 'atlas' ? 1 : 0, now = performance.now();
    const dt = Math.min(0.1, (now - (this._lookAt || now)) / 1000); this._lookAt = now;
    if (this.lookK == null) this.lookK = want;
    if (this.lookK !== want) { this.lookK += Math.sign(want - this.lookK) * Math.min(Math.abs(want - this.lookK), Math.max(dt, 0.016) * 2.5); this.needsDraw = true; }
    const k = this.lookK, A = LOOKS.anatomy, B = LOOKS.atlas, L = this._look || (this._look = {});
    for (const key in A) if (key !== 'bg') L[key] = A[key] + (B[key] - A[key]) * k;
    L.k = k;
    if (this.scene && this.scene.background && this._lookBgK !== k) {
      this._lookBgK = k;
      this.scene.background.setHex(A.bg).lerp(this._bgB || (this._bgB = new THREE.Color(B.bg)), k);
    }
    return L;
  }
  lobeTint(lobe) {
    const c = this._lobeTint || (this._lobeTint = {});
    return c[lobe] || (c[lobe] = new THREE.Color(LOBES[lobe] ? LOBES[lobe].color : '#ffffff'));
  }

  draw() {
    this.updateCamera();
    const U = this.brainMat.uniforms, LK = this.lookParams();
    U.uLook.value = LK.k;
    // pulses: upload the strongest MAXP to the GPU
    const env = (p) => { const r = p.rise || 0.18; const a = Math.min(1, p.t / r); const d = Math.max(0, 1 - (p.t - r) / (p.life - r)); return p.amp * a * a * (3 - 2 * a) * d * d; };
    const breath = this.breaths();
    const ps = breath.concat(this.pulses.map(p => [p, env(p)]).sort((a, b) => b[1] - a[1]).slice(0, MAXP - breath.length));
    let np = 0;
    for (const [p, k] of ps) {
      if (np >= MAXP || k < 0.004) continue;
      U.uPulse.value[np].set(p.x, p.y, p.z, p.sigma); U.uPulseC.value[np].set(p.c.r, p.c.g, p.c.b, k); np++;
    }
    U.uNP.value = np;
    let nw = 0;
    for (const w of this.waves) {
      if (nw >= MAXW) break;
      U.uWave.value[nw].set(w.x, w.y, w.z, w.r); U.uWaveC.value[nw].set(w.c.r, w.c.g, w.c.b, w.amp * Math.max(0, 1 - w.r / 170)); nw++;
    }
    U.uNW.value = nw;
    const on = this.plugin.settings.memoryTrace !== false, K = this.plugin.engK();
    U.uEngOn.value = on ? 1 : 0; U.uEngK.value = K;
    const nowMs = performance.now();
    if (this.engDirty && nowMs - (this.engUp || 0) > 120) { this.engAttr.needsUpdate = true; this.engDirty = false; this.engUp = nowMs; }
    if (this.tractMat) {
      this.tractMat.uniforms.uEngK.value = on ? K : 0;
      if (this.useDirty && nowMs - (this.useUp || 0) > 200) { this.tractUseAttr.needsUpdate = true; this.useDirty = false; this.useUp = nowMs; }
    }
    for (let i = 0; i < 8; i++) U.uDim.value[i] = this.dim.has(LOBE_ORDER[i]) ? 0.25 : 1;
    U.uGlass.value = this.plugin.settings.glass;

    // notes
    const ng = this.nodeGeo;
    if (ng) {
      const pos = ng.attributes.position.array, colA = ng.attributes.aColor.array, size = ng.attributes.aSize.array, glow = ng.attributes.aGlow.array;
      this.nodes.forEach((n, i) => {
        pos[i * 3] = n.x; pos[i * 3 + 1] = n.y; pos[i * 3 + 2] = n.z;
        const dimmed = this.dim.has(n.lobe);
        const a = Math.min(1, n.act);
        const base = (n.hub ? 0.24 : n.learned ? 0.26 + Math.min(0.14, n.w * 0.02) : 0.3) * LK.node;
        const c = n.actColor;
        let br = n.learned ? 1.0 : 0.93, bg = n.learned ? 0.76 : 0.9, bb = n.learned ? 0.48 : 0.84;   // learned files glow warm
        // atlas: notes take a soft tint of their region, so the regions read at a glance
        if (LK.tint > 0 && !n.learned) { const t = this.lobeTint(n.lobe), q = LK.tint; br = br * (1 - q) + t.r * q; bg = bg * (1 - q) + t.g * q; bb = bb * (1 - q) + t.b * q; }
        colA[i * 3] = (br * (1 - a) + c.r * a) * (dimmed ? 0.15 : base + a);
        colA[i * 3 + 1] = (bg * (1 - a) + c.g * a) * (dimmed ? 0.15 : base + a);
        colA[i * 3 + 2] = (bb * (1 - a) + c.b * a) * (dimmed ? 0.15 : base + a);
        size[i] = n.size * LK.nodeSize * (n === this.hover ? 1.8 : 1);
        glow[i] = a * (n.hub ? 0.45 : 0.7);
      });
      ng.attributes.position.needsUpdate = true; ng.attributes.aColor.needsUpdate = true; ng.attributes.aSize.needsUpdate = true; ng.attributes.aGlow.needsUpdate = true;
      this.nodeObj.material.uniforms.uScale.value = this.cssH * 0.9 * Math.min(2, window.devicePixelRatio || 1);
      this.nodeObj.material.uniforms.uRing.value = LK.ring;
    }
    if (this.linkObj) this.linkObj.material.opacity = LK.link;
    if (this.learnObj) this.learnObj.material.opacity = LK.learn;
    if (this.tractMat) this.tractMat.uniforms.uOpacity.value = this.tractMat.uniforms.uSlabOn.value > 0.5 ? LOOKS.anatomy.tract : LK.tract;
    // spikes: light trails travelling along link curves
    const sg = this.spikeGeo;
    if (sg) {
      const pos = sg.attributes.position.array, colA = sg.attributes.aColor.array, size = sg.attributes.aSize.array, glow = sg.attributes.aGlow.array;
      let k = 0;
      const TR = 6;
      for (const s of this.plugin.settings.showNotes === false ? [] : this.spikes) {
        if (k + TR > 2400) break;
        const l = s.l, fwd = l.a === s.a, A = fwd ? l.a : l.b, B = fwd ? l.b : l.a;
        for (let j = 0; j < TR; j++) {
          const t = Math.max(0, s.t - j * 0.035), u = 1 - t, f = 1 - j / TR;
          pos[k * 3] = u * u * A.x + 2 * u * t * l.c.x + t * t * B.x;
          pos[k * 3 + 1] = u * u * A.y + 2 * u * t * l.c.y + t * t * B.y;
          pos[k * 3 + 2] = u * u * A.z + 2 * u * t * l.c.z + t * t * B.z;
          colA[k * 3] = s.c.r * f * LK.spike; colA[k * 3 + 1] = s.c.g * f * LK.spike; colA[k * 3 + 2] = s.c.b * f * LK.spike;
          size[k] = (j === 0 ? 3.2 : 2.4) * f; glow[k] = j === 0 ? 0.55 : 0.2 * f;
          k++;
        }
      }
      // signals running along real fibre tracts
      const tp = this._tp || (this._tp = { x: 0, y: 0, z: 0 });
      for (const sp of this.tractSpikes || []) {
        for (let j = 0; j < 10 && k < 5000; j++) {
          const tt = Math.max(0, sp.t - j * 0.016), f = (1 - j / 10) * sp.k;
          this.tractPoint(sp.l, sp.fwd ? tt : 1 - tt, tp);
          pos[k * 3] = tp.x; pos[k * 3 + 1] = tp.y; pos[k * 3 + 2] = tp.z;
          colA[k * 3] = sp.c.r * f * LK.spike; colA[k * 3 + 1] = sp.c.g * f * LK.spike; colA[k * 3 + 2] = sp.c.b * f * LK.spike;
          size[k] = (j === 0 ? 4.4 : 2.8) * (0.5 + 0.5 * f); glow[k] = j === 0 ? 0.75 : 0.25 * f;
          k++;
        }
      }
      sg.setDrawRange(0, k);
      sg.attributes.position.needsUpdate = true; sg.attributes.aColor.needsUpdate = true; sg.attributes.aSize.needsUpdate = true; sg.attributes.aGlow.needsUpdate = true;
      this.spikeObj.material.uniforms.uScale.value = this.nodeObj ? this.nodeObj.material.uniforms.uScale.value : 300;
      this.spikeObj.material.uniforms.uRing.value = LK.ring * 0.5;
    }
    {
      const on = this.plugin.settings.memoryTrace !== false, K = this.plugin.engK(), vl = this.vitalLevel || 0;
      for (const it of this.inner || []) {
        let act = it.act;
        // ventricles: memory pressure of the busiest machine (only above half full, so they stay quiet normally)
        if (it.kind === 'csf' && vl > 0.5 && act < (vl - 0.5) * 1.2) { act = (vl - 0.5) * 1.2; it.actColor.set(vl > 0.88 ? WAIT : VITAL); }
        it.mat.uniforms.uAct.value = act; it.mat.uniforms.uActColor.value.copy(it.actColor);
        if (it.alpha0 != null) it.mat.uniforms.uAlpha.value = it.alpha0 * LK.inner;
        const tv = on && it.eng > 0 ? 1 - Math.exp(-it.eng * K * 0.1) : 0;
        it.mat.uniforms.uTrace.value = tv;
        if (tv > 0) it.mat.uniforms.uTraceC.value.setRGB(it.engC.r / it.eng, it.engC.g / it.eng, it.engC.b / it.eng);
      }
    }
    if (this.slice && this.slice.mesh.parent) {
      const SU = this.slice.mat.uniforms; let ni = 0;
      for (const it of this.inner || []) {
        if (it.act < 0.02 || ni >= 16) continue;
        SU.uInnerP.value[ni].set(it.center.x, it.center.y, it.center.z, it.name === 'Hippocampus' || it.name === 'Caudate nucleus' ? 9 : 7);
        SU.uInnerC.value[ni].set(it.actColor.r, it.actColor.g, it.actColor.b, it.act * 0.9); ni++;
      }
      SU.uNI.value = ni;
    }
    this.updateClip();
    const glow = this.plugin.settings.bloom === false ? 0 : Number(this.plugin.settings.glow);
    this.bloom.enabled = glow > 0.02;
    this.bloom.strength = 0.9 * glow * LK.bloom;
    this.composer.render();
    this.drawOverlay();
  }

  drawOverlay() {
    const ctx = this.octx, dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const o = { x: 0, y: 0, z: 0 };
    for (const n of this.nodes) { this.project(n.x, n.y, n.z, o); n.sx = o.x; n.sy = o.y; n.vis = o.z < 1; }
    const mono = this.fontUI();
    const camPos = this.camera.position;

    // the signal you point at or picked: its whole pathway, and where it is now
    for (const [h, strong] of [[this.selSpike, true], [this.hoverSpike, false]]) {
      if (!h || (this.selSpike && !strong && h.sp === this.selSpike.sp)) continue;
      const sp = h.sp, col = '#' + col3(sp.hex || '#ffffff').getHexString();
      ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = strong ? 0.9 : 0.6; ctx.lineWidth = strong ? 2 : 1.4; ctx.setLineDash(strong ? [] : [4, 3]);
      ctx.beginPath();
      if (h.kind === 'tract') {
        const pts = sp.l.pts, n = pts.length / 3;
        for (let i = 0; i < n; i++) { this.project(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], o); if (i) ctx.lineTo(o.x, o.y); else ctx.moveTo(o.x, o.y); }
      } else {
        const l = sp.l;
        for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; this.project(u * u * l.a.x + 2 * u * t * l.c.x + t * t * l.b.x, u * u * l.a.y + 2 * u * t * l.c.y + t * t * l.b.y, u * u * l.a.z + 2 * u * t * l.c.z + t * t * l.b.z, o); if (i) ctx.lineTo(o.x, o.y); else ctx.moveTo(o.x, o.y); }
      }
      ctx.stroke(); ctx.setLineDash([]);
      // where it is now (recomputed, so the ring follows it in slow motion)
      const cur = this.spikeHeads().find(x => x.sp === sp) || h;
      this.project(cur.x, cur.y, cur.z, o);
      ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(o.x, o.y, strong ? 9 : 7, 0, Math.PI * 2); ctx.stroke();
      // and where it lands
      const st = sp.src && sp.src.st, g = st && this.gyrusAnchor[st.label];
      if (g && !sp.back) { this.project(g.x, g.y, g.z, o); ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(o.x, o.y, 5, 0, Math.PI * 2); ctx.stroke(); ctx.font = `10px ${mono}`; ctx.fillStyle = col; ctx.fillText(aalName(st.label), o.x + 8, o.y + 3); }
      ctx.restore();
    }

    // live lines per region: who is doing what right now
    const live = {};
    const nowMs = Date.now();
    const addLine = (lobe, ln) => { (live[lobe] || (live[lobe] = [])).push(ln); };
    for (const s of this.replay ? [] : this.plugin.sessions.values()) {
      if (this.focusSid && s.id !== this.focusSid) continue;
      const name = this.plugin.sessionLabel(s);
      if (s.wait && s.wait.kind === 'approval') addLine('frontal', { color: s.color, proj: name, text: 'Needs your approval', t: fmtDur(nowMs - s.wait.since), a: 1, warn: true, sid: s.id, lobe: 'frontal' });
      else if (this.plugin.isLive(s) && s.phase === 'thinking') addLine('frontal', { color: s.color, proj: name, text: 'Thinking', t: fmtDur(nowMs - s.since), a: 1, sid: s.id, lobe: 'frontal' });
      else if (this.plugin.isLive(s) && s.phase === 'tool' && nowMs - s.since > 2500) addLine(s.toolLobe, { color: s.color, proj: name, text: s.state, t: fmtDur(nowMs - s.since), a: 1, sid: s.id, lobe: s.toolLobe });
      if (s.workflow && s.workflow.active) {
        const running = this.plugin.runningAgents(s).filter(a => a.wf).length;
        addLine('parietal', { color: s.color, proj: name, text: `Workflow ${s.workflow.name}: ${running} running, ${s.workflow.done} done`, t: '', a: 1, sid: s.id + '/wf' });
      }
    }
    for (const tg of this.tags.slice().reverse()) {
      if ((live[tg.lobe] || []).some(l => l.sid === tg.sid || l.sid === tg.sid + '/wf')) continue;
      if ((live[tg.lobe] || []).some(l => l.proj === tg.proj.split(' › ')[0])) continue;   // one line per session per region
      addLine(tg.lobe, { color: tg.color, proj: tg.proj.split(' › ')[0], text: tg.text, t: '', a: Math.min(1, (4.5 - tg.t) / 1.2), sid: tg.sid });
    }

    // region labels: thin leader line from the centroid on the camera-facing hemisphere.
    // Laid out first, then stacked per side so blocks never overlap and stay inside the view.
    // The sidebar mini view skips them: the session list there already says who is doing what.
    if (!this.mini) {
      ctx.textBaseline = 'middle';
      const blocks = [];
      for (const k of ['frontal', 'motor', 'parietal', 'temporal', 'occipital', 'cerebellum']) {
        const lines = (live[k] || []).slice(0, 2);
        if ((!this.plugin.settings.regionLabels || this.mini) && !lines.length) continue;
        const L = this.regions[k + 'L'], R = this.regions[k + 'R'];
        if (!L || !R) continue;
        const dl = (L.x - camPos.x) ** 2 + (L.y - camPos.y) ** 2 + (L.z - camPos.z) ** 2;
        const dr = (R.x - camPos.x) ** 2 + (R.y - camPos.y) ** 2 + (R.z - camPos.z) ** 2;
        const C = dl < dr ? L : R;
        const len = Math.hypot(C.x, C.y + 6, C.z) || 1;
        const out = 1 + 34 / len;
        const P = this.project(C.x * 1.04, C.y * 1.04, C.z * 1.04, { x: 0, y: 0, z: 0 });
        const Q = this.project(C.x * out, (C.y + 6) * out - 6 + 10, C.z * out, { x: 0, y: 0, z: 0 });
        const right = Q.x >= P.x;
        const rows = lines.map(ln => {
          ctx.font = `600 10.5px ${mono}`; const pw = ctx.measureText(ln.proj).width;
          const body = clip(ln.text, 28) + (ln.t ? '  ' + ln.t : '');
          ctx.font = `10.5px ${mono}`; const bw = ctx.measureText(body).width;
          return { ln, body, pw, w: 10 + pw + 8 + bw };
        });
        ctx.font = `600 11px ${mono}`; const tw = ctx.measureText(cap(LOBES[k].label.toLowerCase())).width;
        const fn = LOBES[k].fn.replace(' · ', ', ');
        ctx.font = `10px ${mono}`; const fw = lines.length ? 0 : ctx.measureText(fn).width;
        const w = Math.max(tw, fw, ...rows.map(r => r.w));
        const h = 13 + (lines.length ? lines.length * 14 + 1 : 13);
        blocks.push({ k, P, Q, right, rows, fn, w, h, top: Q.y - 12, x: right ? Q.x + 6 : Q.x - 6 - w, alpha: this.dim.has(k) ? 0.2 : lines.length ? 0.95 : 0.8 });
      }
      const cls = this.contentEl.classList;
      const drawerTop = cls.contains('cb-has-tl') ? this.cssH - 152 : this.cssH - 62;
      const floor = (right) => (!right && cls.contains('cb-show-activity') ? drawerTop - 170 : drawerTop) - 8;
      for (const side of [true, false]) {
        const g = blocks.filter(bk => bk.right === side).sort((p, q) => p.top - q.top);
        for (let i = 1; i < g.length; i++) { const prev = g[i - 1]; if (g[i].top < prev.top + prev.h + 4) g[i].top = prev.top + prev.h + 4; }
        for (let i = g.length - 1; i >= 0; i--) {
          const maxTop = (i === g.length - 1 ? floor(side) : g[i + 1].top - 4) - g[i].h;
          if (g[i].top > maxTop) g[i].top = maxTop;
        }
      }
      this.labelBlocks = blocks;
      // keep labels clear of the region list on the left and the detail panel on the right
      const leftEdge = !this.mini && this.cssW > 700 && this.tlColEl ? this.tlColEl.offsetLeft + this.tlColEl.offsetWidth + 12 : 8;
      const rightEdge = this.cssW - 8 - (this.panel && !this.mini ? this.panelWidth() + 22 : 0);
      for (const bk of blocks) {
        bk.x = Math.max(leftEdge, Math.min(rightEdge - bk.w, bk.x));
        const { P, alpha } = bk;
        const anchorX = bk.right ? bk.x - 6 : bk.x + bk.w + 6, anchorY = bk.top + 6;
        ctx.strokeStyle = `rgba(190,205,230,${alpha * 0.45})`; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(anchorX, anchorY); ctx.stroke();
        ctx.fillStyle = LOBES[bk.k].color; ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(P.x, P.y, 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        const tx = (w) => bk.right ? bk.x : bk.x + bk.w - w;
        ctx.font = `600 11px ${mono}`; ctx.fillStyle = `rgba(236,240,247,${alpha})`;
        const ttl = cap(LOBES[bk.k].label.toLowerCase());
        ctx.fillText(ttl, tx(ctx.measureText(ttl).width), bk.top + 6);
        if (!bk.rows.length) {
          ctx.font = `10px ${mono}`; ctx.fillStyle = `rgba(150,160,178,${alpha})`;
          ctx.fillText(bk.fn, tx(ctx.measureText(bk.fn).width), bk.top + 19);
          continue;
        }
        bk.rows.forEach((r, i) => {
          const y = bk.top + 20 + i * 14, ln = r.ln;
          const x0 = tx(r.w);
          ctx.globalAlpha = ln.a;
          ctx.fillStyle = ln.warn ? WAIT : ln.color;
          ctx.beginPath(); ctx.arc(x0 + 3, y, 2.6, 0, Math.PI * 2); ctx.fill();
          ctx.font = `600 10.5px ${mono}`; ctx.fillStyle = ln.color;
          ctx.fillText(ln.proj, x0 + 10, y);
          ctx.font = `10.5px ${mono}`; ctx.fillStyle = ln.warn ? WAIT : 'rgba(225,231,240,0.92)';
          ctx.fillText(r.body, x0 + 10 + r.pw + 8, y);
          ctx.globalAlpha = 1;
        });
      }
    }
    // target rings and note labels
    for (const p of this.plugin.settings.showNotes === false ? [] : this.pings) {
      const k = p.t / 1.2, n = p.n;
      const pc = p.c || n.actColor;
      ctx.strokeStyle = `rgba(${Math.round(pc.r * 255)},${Math.round(pc.g * 255)},${Math.round(pc.b * 255)},${0.75 * (1 - k)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.sx, n.sy, 6 + 22 * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = `500 11px ${mono}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (const n of this.nodes) {
      const show = this.plugin.settings.showNotes !== false && (n === this.hover || (n.labelT > 0 && !this.mini));
      if (!show || !n.vis) continue;
      const a = n === this.hover ? 0.95 : Math.min(0.92, n.labelT / 1.2);
      ctx.fillStyle = `rgba(240,244,250,${a})`;
      ctx.fillText(n.name, n.sx + 10, n.sy);
    }
    if (this.hover) {
      const n = this.hover;
      ctx.strokeStyle = 'rgba(240,244,250,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(n.sx, n.sy, 7, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.mini) return;
    // orientation gizmo
    return;   // no orientation gizmo: the HUD stays minimal
    const gx = this.cssW - 40 - (this.panel ? 352 : 0), gy = this.cssH - 44 - (this.contentEl.classList.contains('cb-has-tl') ? 96 : 0), gl = 16;
    const e = this.camera.matrixWorldInverse.elements;
    ctx.font = `9px ${mono}`; ctx.textAlign = 'center';
    for (const [lab, x, y, z] of [['A', 0, 0, -1], ['S', 0, 1, 0], ['L', -1, 0, 0]]) {
      const vx = e[0] * x + e[4] * y + e[8] * z, vy = e[1] * x + e[5] * y + e[9] * z;
      ctx.strokeStyle = 'rgba(160,170,188,0.5)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + vx * gl, gy - vy * gl); ctx.stroke();
      ctx.fillStyle = 'rgba(170,180,198,0.8)';
      ctx.fillText(lab, gx + vx * (gl + 8), gy - vy * (gl + 8));
    }
    ctx.strokeStyle = 'rgba(160,170,188,0.25)';
    ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'left';
  }
}

/* ================================================================ plugin */

class AgentBrainPlugin extends Plugin {
  async onload() {
    const data = (await this.loadData()) || {};
    const { memory, learned, daily, engram, regions, ...saved } = data;
    this.settings = Object.assign({}, DEFAULTS, saved);
    this.memory = { at: Date.now(), day: dayKey(), trace: new Array(8).fill(0), today: new Array(8).fill(0) };
    if (memory && Array.isArray(memory.trace) && memory.trace.length === 8) {
      this.memory.at = Number(memory.at) || Date.now();
      this.memory.trace = memory.trace.map(Number);
      if (memory.day === dayKey() && Array.isArray(memory.today)) this.memory.today = memory.today.map(Number);
    }
    this.decayMemory();
    this.learned = learned && learned.neurons && learned.synapses ? learned : { neurons: {}, synapses: {} };
    this.pruneLearned();
    this.daily = daily && daily.day && daily.sessions ? daily : null;
    if (this.daily && this.daily.day !== isoDay()) { const old = this.daily; this.daily = null; this.app.workspace.onLayoutReady(() => this.writeDailyNote(old)); }
    this.engram = { t0: Date.now(), a: {}, n: {}, f: {} };
    if (engram && engram.a && engram.n && engram.f && Number(engram.t0)) this.engram = { t0: Number(engram.t0), a: engram.a, n: engram.n, f: engram.f };
    this.geo = null;
    this.loadedAt = Date.now();
    this.vitals = new Map();
    this.metab = new Map();               // per session: model calls, tokens, cost, context (from Claude Code telemetry)
    this.regionMem = regions && typeof regions === 'object' ? regions : {};   // per gyrus / nucleus: what happened there
    this.history = [];
    this.sources = new Map();
    this.sessions = new Map();
    this.sessionSeq = 0;
    this.eventTimes = [];
    this.serverOk = false;
    this.t0 = performance.now();
    this.registerView(VIEW_TYPE, (leaf) => new BrainView(leaf, this));
    this.registerView(VIEW_MINI, (leaf) => new BrainView(leaf, this, true));
    this.addRibbonIcon('brain-circuit', 'Agent Brain', () => this.activateView());
    this.addCommand({ id: 'open', name: 'Open Agent Brain view', callback: () => this.activateView() });
    this.addCommand({ id: 'demo', name: 'Play demo session', callback: () => this.runDemo() });
    this.addCommand({ id: 'copy-hooks', name: 'Copy Claude Code hook config to clipboard', callback: () => this.copyHooks() });
    this.addCommand({ id: 'reset-memory', name: 'Reset memory trace', callback: () => this.resetMemory() });
    this.addCommand({ id: 'open-mini', name: 'Open mini brain in the right sidebar', callback: () => this.activateMini() });
    this.addCommand({ id: 'daily-note', name: "Write and open today's activity note", callback: async () => { const p = await this.writeDailyNote(null, true); if (!p) new Notice('Agent Brain: no activity recorded today yet.'); } });
    this.addCommand({ id: 'reset-learned', name: 'Forget learned connections', callback: () => this.resetLearned() });
    this.addCommand({ id: 'reset-engram', name: 'Clear the activity trace', callback: () => { this.resetEngram(); new Notice('Agent Brain: activity trace cleared.'); } });
    this.addCommand({ id: 'install-hooks', name: 'Install Claude Code hooks on this computer', callback: () => this.installLocalHooks() });
    this.addSettingTab(new BrainSettingTab(this.app, this));
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass('cb-sb');
    this.registerDomEvent(this.statusBar, 'click', () => this.activateView());
    this.updateStatusBar();
    this.registerInterval(window.setInterval(() => this.pruneSessions(), 30000));
    this.registerInterval(window.setInterval(() => { this.tickMemory(); this.tickAgents(); this.tickSources(); this.pruneHistory(); this.engRebase(); this.tickStuck(); }, 10000));
    this.registerInterval(window.setInterval(() => { if (this.memDirty || this.dailyDirty) this.saveAll(); }, 60000));
    this.registerInterval(window.setInterval(() => { this.pruneLearned(); if (this.dailyDirty) this.writeDailyNote(); }, 10 * 60000));
    this.startServer();
    this.startVitals();
    // the shared geometry (gyri, fibres) lets every event leave its trace even before the view is opened
    this.app.workspace.onLayoutReady(() => window.setTimeout(() => this.loadGeo(), 3000));
  }

  onunload() { this.stopServer(); this.stopVitals(); if (this.dailyDirty) this.writeDailyNote(); this.saveAll(); }

  async saveAll() {
    this.memDirty = false;
    const E = this.engram, r = (v) => Math.round(v * 1e4) / 1e4;
    const eng = { t0: E.t0, a: {}, n: {}, f: {} };
    for (const k in E.a) eng.a[k] = E.a[k].map(r);
    for (const k in E.n) eng.n[k] = E.n[k].map(r);
    for (const k in E.f) eng.f[k] = r(E.f[k]);
    this.pruneRegionMem();
    await this.saveData(Object.assign({}, this.settings, { memory: this.memory, learned: this.learned, daily: this.daily, engram: eng, regions: this.regionMem }));
  }

  /* ---------- shared neural geometry: gyrus anchors and fibre endpoints, the same for every view ---------- */

  async loadGeo() {
    if (this.geo) return this.geo;
    try { const [m, A] = await Promise.all([this.loadBrainMesh(), this.loadAnatomy()]); return this.ensureGeo(m, A); } catch (e) { console.error('[agent-brain] geometry', e); return null; }
  }
  ensureGeo(m, A) {
    if (this.geo) return this.geo;
    const P = m.pos, anchors = [];
    if (A && A.aal && A.aal.length === m.nv) {
      const acc = [];
      for (let i = 0; i < m.nv; i++) { const l = A.aal[i]; const a = acc[l] || (acc[l] = [0, 0, 0, 0, []]); a[0] += P[i * 3]; a[1] += P[i * 3 + 1]; a[2] += P[i * 3 + 2]; a[3]++; a[4].push(i); }
      acc.forEach((a, l) => {
        if (!a || !l) return;
        const cx = a[0] / a[3], cy = a[1] / a[3], cz = a[2] / a[3];
        // the vertex of this gyrus that sticks out furthest from the brain centre near its centroid
        let best = -1, bs = -Infinity;
        for (const i of a[4]) {
          const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz;
          const score = -(dx * dx + dy * dy + dz * dz) * 0.04 + m.depth[i] * 6;
          if (score > bs) { bs = score; best = i; }
        }
        anchors[l] = { x: P[best * 3], y: P[best * 3 + 1], z: P[best * 3 + 2], label: l };
      });
    }
    const T = (A && A.tracts) || [], ends = new Float32Array(T.length * 6), bundleIdx = new Map();
    T.forEach((l, i) => {
      const base = l.bundle.replace(/_[LR]$/, '');
      (bundleIdx.get(base) || bundleIdx.set(base, []).get(base)).push(i);
      const p = l.pts, n = p.length / 3;
      ends[i * 6] = p[0]; ends[i * 6 + 1] = p[1]; ends[i * 6 + 2] = p[2]; ends[i * 6 + 3] = p[n * 3 - 3]; ends[i * 6 + 4] = p[n * 3 - 2]; ends[i * 6 + 5] = p[n * 3 - 1];
    });
    this.geo = { anchors, ends, bundleIdx, bundleOf: T.map(l => l.bundle), nTracts: T.length };
    return this.geo;
  }
  // where an action lands: a gyrus (AAL label) for that kind of work, always the same one for the same target
  labelFor(kind, key) {
    const list = GYRI[kind] || GYRI.other;
    const ok = this.geo && this.geo.anchors.length ? list.filter(l => this.geo.anchors[l]) : list;
    if (!ok.length) return list[0] || 0;
    return ok[strHash(String(key == null ? kind : key)) % ok.length];
  }
  // the fibre of these bundles that ends nearest `target`, travelling towards it: { i, toEnd }
  fibreNear(bundles, target, key) {
    const G = this.geo;
    if (!G || !G.nTracts || !target) return null;
    const E = G.ends, cand = [];
    for (const b of bundles || []) for (const i of G.bundleIdx.get(b) || []) {
      const d0 = (E[i * 6] - target.x) ** 2 + (E[i * 6 + 1] - target.y) ** 2 + (E[i * 6 + 2] - target.z) ** 2;
      const d1 = (E[i * 6 + 3] - target.x) ** 2 + (E[i * 6 + 4] - target.y) ** 2 + (E[i * 6 + 5] - target.z) ** 2;
      cand.push([Math.min(d0, d1), i, d1 < d0]);
    }
    if (!cand.length) return null;
    cand.sort((x, y) => x[0] - y[0]);
    const best = Math.sqrt(cand[0][0]), top = cand.slice(0, 6).filter(c => Math.sqrt(c[0]) < best + 12);
    const c = top[key == null ? Math.floor(Math.random() * top.length) : strHash(String(key)) % top.length];
    return { i: c[1], toEnd: c[2] };
  }
  fibreFor(kind, label, key) { return this.geo ? this.fibreNear(ROUTES[kind] || ROUTES.other, this.geo.anchors[label], key) : null; }
  fibreAny(kind) {
    const G = this.geo; if (!G || !G.nTracts) return null;
    const pool = []; for (const b of ROUTES[kind] || []) pool.push(...(G.bundleIdx.get(b) || []));
    if (!pool.length) return null;
    return { i: pool[Math.floor(Math.random() * pool.length)], toEnd: Math.random() < 0.5 };
  }

  /* ---------- engram: every action leaves a lasting trace where it happened; it fades with a half-life ---------- */

  engTau() { return Math.max(5, Number(this.settings.traceMinutes) || 90) * 60000 / Math.LN2; }
  engStore() { return this.engram || (this.engram = { t0: Date.now(), a: {}, n: {}, f: {} }); }
  engScale(t) { return Math.exp(((t || Date.now()) - this.engStore().t0) / this.engTau()); }
  engK() { return Math.exp(-(Date.now() - this.engStore().t0) / this.engTau()); }
  engRebase(force) {
    const E = this.engStore(), now = Date.now(), tau = this.engTau();
    if (!force && now - E.t0 < tau * 6) return false;
    const k = Math.exp(-(now - E.t0) / tau);
    for (const m of [E.a, E.n]) for (const key in m) { const v = m[key]; v[0] *= k; v[1] *= k; v[2] *= k; if (Math.max(v[0], v[1], v[2]) < 0.003) delete m[key]; }
    for (const key in E.f) { E.f[key] *= k; if (E.f[key] < 0.003) delete E.f[key]; }
    E.t0 = now;
    this.forEachView(v => v.loadEngram && v.loadEngram());
    return true;
  }
  resetEngram() { this.engram = { t0: Date.now(), a: {}, n: {}, f: {} }; this.forEachView(v => v.loadEngram && v.loadEngram()); this.saveAll(); }

  // what an event does, as strikes: [{ kind, label, fibre, hex, w, nucleus }]
  strikesFor(r) {
    let what = '';
    const S = (kind, key, w, hex, nucleus) => {
      const label = this.labelFor(kind, key);
      return { kind, label, w, what, hex: hex || (CAT[kind] ? catColor(kind) : KIND_HEX[kind] || SIGNAL), nucleus: nucleus === undefined ? (NUCLEUS[kind] || KIND_NUCLEUS[kind] || null) : nucleus, fibre: this.fibreFor(kind, label, key) };
    };
    what = clip(r.e === 'PreToolUse' ? strikeWhat(r) : r.text || '', 48);
    switch (r.e) {
      case 'PreToolUse': {
        if (r.parts && r.parts.length > 1) return r.parts.map((pt, i) => { what = pt[1] || 'shell'; return S(pt[0], pt[1] + '|' + i + '|' + (r.cwd || ''), 1.15 / Math.sqrt(r.parts.length)); });
        return [S(r.cat || 'other', r.file || r.key || r.text || r.tool, 1)];
      }
      case 'UserPromptSubmit': return [S('prompt', r.sid, 0.5)];
      case 'UserPromptExpansion': return [S('prompt', r.text || r.sid, 0.5)];
      case 'Message': return [S('speak', r.sid, Math.min(1.2, 0.15 + (r.n || 0) / 2500))];
      case 'PostToolUseFailure': return [S('alarm', r.tool, 0.6, ERR)];
      case 'PermissionDenied': return [S('alarm', r.tool || 'denied', 0.6, ERR)];
      case 'StopFailure': return [S('alarm', r.text || 'error', 0.8, ERR)];
      case 'PermissionRequest': return [S('alarm', r.tool, 0.45, WAIT)];
      case 'Elicitation': return [S('social', r.text || r.tool, 0.45, WAIT)];
      case 'ElicitationResult': return [S('social', r.text || r.tool, 0.35)];
      case 'InstructionsLoaded': return [S('self', r.file, 0.35)];
      case 'ConfigChange': return [S('self', 'config', 0.3)];
      case 'TaskCreated': return [S('plan', r.text, 0.5)];
      case 'TaskCompleted': return [S('reward', r.text, 0.6, GOLD)];
      case 'CwdChanged': case 'DirectoryAdded': case 'WorktreeCreate': case 'WorktreeRemove': return [S('place', r.file, 0.35)];
      case 'FileChanged': return [S('sense', r.file, 0.25)];
      case 'PreCompact': case 'PostCompact': return [S('memory', r.sid, 0.5), S('memory', r.sid + '/2', 0.3)];
      case 'Thought': what = r.text || ''; return [S('think', r.sid + '/' + (r.n || 0), Math.min(0.6, 0.05 + (r.out || 0) / 5000))];
      default: return [];
    }
  }
  deposit(strikes, t, scale) {
    if (!strikes || !strikes.length) return;
    const E = this.engStore(), f0 = this.engScale(t) * (scale == null ? 1 : scale);
    for (const st of strikes) {
      const c = col3(st.hex), f = st.w * f0;
      const A = E.a[st.label] || (E.a[st.label] = [0, 0, 0]); A[0] += c.r * f; A[1] += c.g * f; A[2] += c.b * f;
      if (st.nucleus) { const N = E.n[st.nucleus] || (E.n[st.nucleus] = [0, 0, 0]); N[0] += c.r * f * 0.6; N[1] += c.g * f * 0.6; N[2] += c.b * f * 0.6; }
      if (st.fibre) E.f[st.fibre.i] = (E.f[st.fibre.i] || 0) + f * 0.7;
    }
    this.memDirty = true;
    this.forEachView(v => v.onEngram && v.onEngram(strikes, f0));
  }

  /* ---------- memory trace: which regions did the work today ---------- */

  decayMemory() {
    const m = this.memory, now = Date.now();
    const k = Math.pow(0.5, Math.max(0, now - m.at) / TRACE_HALF_LIFE);
    for (let i = 0; i < 8; i++) m.trace[i] *= k;
    m.at = now;
    if (m.day !== dayKey()) { m.day = dayKey(); m.today.fill(0); }
  }
  bumpMemory(lobe, amt, count) {
    const i = LOBE_ORDER.indexOf(lobe);
    if (i < 0) return;
    this.decayMemory();
    this.memory.trace[i] += amt;
    if (count) this.memory.today[i] += 1;
    this.memDirty = true;
  }
  tickMemory() { /* the trace only counts tool calls; thinking time no longer piles up on the frontal lobe */ }
  traceLevels() {
    this.decayMemory();
    const t = this.memory.trace, mx = Math.max(...t);
    if (mx <= 0.01) return t.map(() => 0);
    const top = 1 - Math.exp(-mx / 15);
    return t.map(v => Math.sqrt(v / mx) * top);
  }
  resetMemory() {
    this.memory = { at: Date.now(), day: dayKey(), trace: new Array(8).fill(0), today: new Array(8).fill(0) };
    this.saveAll();
    new Notice('Agent Brain: memory trace cleared.');
  }

  // the anatomy files are not part of main.js: they come with the release and are fetched from it once when missing
  // (a plugin installed from the community list only gets main.js, manifest.json and styles.css)
  pluginDir() { return this.manifest && this.manifest.dir ? this.manifest.dir : `${this.app.vault.configDir}/plugins/agent-brain`; }
  async fetchAsset(name) {
    const meta = ASSETS[name];
    if (!meta || !REPO || typeof requestUrl !== 'function') throw new Error(name + ' is missing');
    if (!this._fetchNotice) this._fetchNotice = new Notice(`Agent Brain: downloading the brain anatomy (${(Object.values(ASSETS).reduce((n, a) => n + a.size, 0) / 1048576).toFixed(1)} MB) from the GitHub release. This happens once.`, 8000);
    const url = `https://github.com/${REPO}/releases/download/${this.manifest.version}/${name}`;
    const res = await requestUrl({ url, method: 'GET', throw: false });
    if (res.status !== 200) throw new Error(`could not download ${name} (HTTP ${res.status})`);
    const ab = res.arrayBuffer;
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', ab))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== meta.sha256) throw new Error(`${name} did not match its checksum`);
    try { await this.app.vault.adapter.writeBinary(`${this.pluginDir()}/${name}`, ab); } catch (e) { console.warn('[agent-brain] could not cache', name, e); }
    return ab;
  }
  async readAsset(name) {
    const dir = this.pluginDir();
    for (const n of [name + '.gz', name]) { try { return await this.app.vault.adapter.readBinary(`${dir}/${n}`); } catch (e) { /* next */ } }
    return this.fetchAsset(name + '.gz');
  }

  async loadBrainMesh() {
    if (this._mesh) return this._mesh;
    const ab = await this.readAsset('brain.bin');
    if (!ab) throw new Error('brain.bin.gz not found');
    let u8 = new Uint8Array(ab);
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      const zlib = require('zlib');
      const out = zlib.gunzipSync(Buffer.from(u8));
      u8 = new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    }
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const dv = new DataView(buf);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'CBR1') throw new Error('invalid brain model file');
    const nv = dv.getUint32(4, true), nf = dv.getUint32(8, true);
    let o = 12;
    const q = new Int16Array(buf.slice(o, o + nv * 6)); o += nv * 6;
    const depthU8 = new Uint8Array(buf, o, nv); o += nv;
    const lobeU8 = new Uint8Array(buf, o, nv); o += nv;
    const idx = new Uint32Array(buf.slice(o, o + nf * 12));
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) pos[i] = q[i] / 100;
    const depth = new Float32Array(nv), lobe = new Float32Array(nv);
    for (let i = 0; i < nv; i++) { depth[i] = depthU8[i] / 255; lobe[i] = lobeU8[i]; }
    this._mesh = { nv, nf, pos, depth, lobe, idx };
    return this._mesh;
  }

  // other binary assets next to main.js (gzip optional)
  async loadAsset(name) {
    let ab = null;
    try { ab = await this.readAsset(name); } catch (e) { console.warn('[agent-brain]', e.message || e); return null; }
    if (!ab) return null;
    let u8 = new Uint8Array(ab);
    if (u8[0] === 0x1f && u8[1] === 0x8b) {
      const out = require('zlib').gunzipSync(Buffer.from(u8));
      u8 = new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    }
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  async loadAnatomy() {
    if (this._anat) return this._anat;
    const [aal, inner, t1, tracts] = await Promise.all(['aal.bin', 'inner.bin', 't1.bin', 'tracts.bin'].map(n => this.loadAsset(n).catch(() => null)));
    const safe = (f, b) => { try { return b ? f(b) : null; } catch (e) { console.error('[agent-brain]', e); return null; } };
    this._anat = { aal: safe(parseAal, aal), inner: safe(parseInner, inner), t1: safe(parseT1, t1), tracts: safe(parseTracts, tracts) };
    return this._anat;
  }

  startServer() {
    this.stopServer();
    const port = Number(this.settings.port) || DEFAULTS.port;
    const srv = http.createServer((req, res) => {
      const url = req.url || '';
      // Only Claude Code, the server scripts and the SSH tunnel talk to this listener. A web page open in a browser on
      // this machine can reach 127.0.0.1 too, so anything that looks like it came from one is refused: browsers add
      // Sec-Fetch-* and Origin headers, and DNS rebinding shows up as a Host other than this machine.
      if (!fromThisMachine(req.headers)) {
        res.writeHead(403); res.end(); req.resume();
        if (!this._refusedNote) {
          this._refusedNote = true;
          const h = req.headers;
          console.warn('[agent-brain] refused a request that looked like it came from a web page', { host: h.host, origin: h.origin, site: h['sec-fetch-site'], url });
          new Notice('Agent Brain refused a request to its listener that looked like it came from a web page. If your hooks stop showing up, see the developer console.', 10000);
        }
        return;
      }
      const src = String(req.headers['x-brain-source'] || 'local').replace(/[^\w.-]/g, '').slice(0, 40) || 'local';
      if (req.method === 'GET' && url === '/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('agent-brain'); return; }
      // server setup script, fetched through the tunnel:  curl -s http://127.0.0.1:27182/install.sh | sh
      if (req.method === 'GET' && url === '/install.sh') { res.writeHead(200, { 'Content-Type': 'text/x-sh; charset=utf-8' }); res.end(INSTALL_SH); return; }
      // Claude Code telemetry (OTLP/HTTP JSON): every model call with its tokens, time and cost
      if (req.method === 'POST' && /^\/v1\/(logs|metrics|traces)/.test(url)) {
        const parts = []; let n = 0, big = false;
        req.on('data', (c) => { n += c.length; if (n > 16 * 1024 * 1024) big = true; else parts.push(c); });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
          if (big || !url.startsWith('/v1/logs') || !this.settings.telemetry) return;
          try {
            let buf = Buffer.concat(parts);
            if (/gzip/i.test(String(req.headers['content-encoding'] || ''))) buf = require('zlib').gunzipSync(buf);
            if (!/json/i.test(String(req.headers['content-type'] || 'json'))) return;
            this.handleOtelLogs(JSON.parse(buf.toString('utf8')), src);
          } catch (e) { /* ignore a batch we can't read */ }
        });
        return;
      }
      // body signals from a server (brain-link.sh): counters per second, CPU and memory in thousandths
      if (req.method === 'POST' && url.startsWith('/vitals')) {
        let body = '';
        req.on('data', (c) => { if (body.length < 4096) body += c; });
        req.on('end', () => {
          res.writeHead(204); res.end();
          this.noteSource(src, 'beat');
          if (!this.settings.vitals) return;
          try {
            const v = JSON.parse(body), n = (k) => Math.max(0, Number(v[k]) || 0);
            this.noteVitals(src, { cpu: Math.min(1, n('cpu') / 1000), mem: Math.min(1, n('mem') / 1000), rx: n('rx'), tx: n('tx'), rd: n('rd'), wr: n('wr'), load: n('load') / 100, procs: n('procs'), ncpu: n('ncpu') });
          } catch (e) { /* ignore a bad sample */ }
        });
        return;
      }
      if (req.method === 'GET' && url.startsWith('/heartbeat')) {
        let name = src;
        try { name = (new URL(url, 'http://x').searchParams.get('src') || src).replace(/[^\w.-]/g, '').slice(0, 40) || src; } catch (e) { /* */ }
        this.noteSource(name, 'beat');
        res.writeHead(204); res.end(); return;
      }
      const batch = url.startsWith('/batch');
      if (req.method !== 'POST' || !(batch || url.startsWith('/event'))) { res.writeHead(404); res.end(); return; }
      const limit = (batch ? 48 : 4) * 1024 * 1024;
      const chunks = []; let size = 0, aborted = false;
      req.on('data', (c) => {
        if (aborted) return;
        size += c.length;
        if (size > limit) { aborted = true; res.writeHead(413); res.end(); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        res.writeHead(204); res.end();
        const text = Buffer.concat(chunks).toString('utf8');
        if (batch) { try { this.handleBatch(text, src); } catch (e) { console.error('[agent-brain]', e); } return; }
        let ev = null;
        try { ev = JSON.parse(text); } catch (e) { return; }
        try { this.handleEvent(ev, { src }); } catch (e) { console.error('[agent-brain]', e); }
      });
    });
    srv.on('error', (e) => {
      this.serverOk = false; this.updateStatusBar();
      new Notice(`Agent Brain: could not listen on 127.0.0.1:${port} (${e.code || e.message}).`);
    });
    srv.listen(port, '127.0.0.1', () => { this.serverOk = true; this.updateStatusBar(); });
    this.server = srv;
  }

  stopServer() {
    if (this.server) { try { this.server.close(); } catch (e) { /* */ } this.server = null; }
    this.serverOk = false;
  }

  // opts: { src: where it came from, ts: original time (queued events), replay: replayed from the offline queue }
  handleEvent(ev, opts) {
    if (!ev || typeof ev !== 'object' || !ev.hook_event_name) return;
    opts = opts || {};
    // the same event from two hook configs (user and project settings) arrives twice; tool events are told apart by tool_use_id
    if (!opts.replay && ev.hook_event_name !== 'MessageDisplay' && !(ev.tool_name && !ev.tool_use_id)) {
      const key = [ev.session_id, ev.hook_event_name, ev.tool_use_id || '', ev.agent_id || '', ev.prompt_id || '', ev.notification_type || '', ev.message || '', ev.file_path || '', ev.task_name || ''].join('|');
      const now = Date.now(), seen = this.recent || (this.recent = new Map());
      if (seen.has(key) && now - seen.get(key) < 1500) return;
      seen.set(key, now);
      if (seen.size > 400) for (const [k, t] of seen) if (now - t > 5000) seen.delete(k);
    }
    this._now = opts.ts || Date.now(); this._replaying = !!opts.replay;
    try { this.applyEvent(ev, opts, this._now); } finally { this._now = 0; this._replaying = false; }
  }

  applyEvent(ev, opts, now) {
    const sid = String(ev.session_id || 'unknown');
    const e = ev.hook_event_name;
    const src = opts.src || 'local';
    let s = this.sessions.get(sid);
    if (!s) {
      if (e === 'SessionEnd') return;
      s = { id: sid, project: '', state: 'started', last: '', events: 0, at: now, busy: false, phase: 'idle', since: now,
        inflight: 0, toolLobe: 'parietal', turnStart: 0, wait: null, color: this.pickColor(), idx: this.sessionSeq++, src,
        agents: new Map(), pending: [], workflow: null, tasks: new Map(), taskQueue: [], todo: null, planAt: 0 };
      this.sessions.set(sid, s);
    }
    if (!opts.replay) this.lastRealEvent = Date.now();
    if (e === 'MessageDisplay') { s.src = src; this.noteSource(src, 'event', now); this.onSpeech(s, ev, now, opts); return; }
    s.at = Math.max(s.at, now); s.events++; s.src = src;
    if (!opts.replay) this.eventTimes.push(now);
    this.noteSource(src, 'event', now);
    const sub = ev.agent_id ? String(ev.agent_id) : '';
    if (ev.cwd && !sub) s.project = baseName(ev.cwd);
    let a = null, took = 0;
    // events from inside a subagent or workflow agent: tracked per agent, they don't change the main conversation's state
    if (sub && e !== 'Notification' && e !== 'PermissionRequest' && e !== 'Elicitation' && e !== 'SessionStart' && e !== 'SessionEnd') {
      a = this.onAgentEvent(s, ev, sub);
      // an approval this agent was blocked on has been answered
      if (s.wait && s.wait.kind === 'approval' && (!s.wait.agent || s.wait.agent === sub) && /^(PostToolUse|PostToolUseFailure|SubagentStop)$/.test(e)) {
        s.wait = null; s.state = s.inflight ? s.last : 'thinking'; s.busy = true; s.phase = s.inflight ? 'tool' : 'thinking'; s.since = now;
      }
    } else {
      const phase = (p) => { if (s.phase !== p) { s.phase = p; s.since = now; } };
      // any sign of life other than a notification means the session is no longer waiting on you
      if (s.wait && !PASSIVE.has(e)) s.wait = null;
      switch (e) {
        case 'SessionStart': s.state = 'session started'; s.busy = false; s.inflight = 0; phase('idle'); break;
        case 'UserPromptSubmit': s.state = 'thinking'; s.busy = true; s.inflight = 0; s.turnStart = now; s.said = ''; s.saidSeal = false; phase('thinking'); break;
        case 'PreToolUse': {
          const lobe = (CAT[evCat(ev)] || CAT.other).lobe;
          s.state = describe(ev); s.last = s.state; s.busy = true; s.inflight++;
          s.toolLobe = lobe; s.phase = 'tool'; s.since = now;
          if (!s.turnStart) s.turnStart = now;
          this.trackPlan(s, ev);
          break;
        }
        case 'PostToolUse': case 'PostToolUseFailure':
          s.busy = true; s.inflight = Math.max(0, s.inflight - 1); s.saidSeal = true;
          if (!s.inflight) { s.state = 'thinking'; phase('thinking'); }
          this.trackPlan(s, ev);
          break;
        case 'SubagentStart': break;
        case 'SubagentStop': s.state = 'subagent finished'; break;
        case 'PreCompact': s.state = 'compacting context'; phase('compacting'); break;
        case 'PostCompact': if (s.phase === 'compacting') { s.state = s.busy ? 'thinking' : 'context compacted'; phase(s.busy ? 'thinking' : 'idle'); } break;
        case 'Notification': this.onNotification(s, ev); break;
        case 'PermissionRequest': this.onNotification(s, Object.assign({}, ev, { notification_type: 'permission_prompt', message: `Claude needs your permission to use ${toolLabel(ev.tool_name) || 'a tool'}` })); break;
        case 'Elicitation': this.onNotification(s, Object.assign({}, ev, { notification_type: 'elicitation_dialog', message: clip(ev.message || 'An MCP server is asking you something', 120) })); break;
        case 'PermissionDenied': s.state = `${toolLabel(ev.tool_name) || 'tool'} denied`; s.busy = true; s.inflight = Math.max(0, s.inflight - 1); if (!s.inflight) phase('thinking'); break;
        case 'ElicitationResult': s.busy = true; s.state = s.inflight ? s.last : 'thinking'; phase(s.inflight ? 'tool' : 'thinking'); break;
        case 'StopFailure': {
          took = s.turnStart ? now - s.turnStart : 0;
          s.state = `stopped: ${String(ev.error_type || 'error').replace(/_/g, ' ')}`; s.busy = false; s.inflight = 0; s.turnStart = 0; phase('idle');
          s.wait = { kind: 'input', since: now, msg: '', notified: false };
          if (this.settings.notifyReply) { this.alert(s, 'stopped with an error', clip(ev.error_message || ev.error_type || '', 140)); s.wait.notified = true; }
          break;
        }
        case 'Stop': {
          if (s.speakN) this.endSpeech(s, now);
          took = s.turnStart ? now - s.turnStart : 0;
          s.state = 'your turn'; s.busy = false; s.inflight = 0; s.turnStart = 0; phase('idle');
          s.wait = { kind: 'input', since: now, msg: '', notified: false };
          // a long job just finished: tell the user even if Obsidian is in the background
          if (took >= 60000 && this.settings.notifyReply) { this.alert(s, 'finished', `Done after ${fmtDur(took)}. Waiting for your reply.`); s.wait.notified = true; }
          break;
        }
        case 'SessionEnd': this.sessions.delete(sid); break;
        default: break;
      }
    }
    if (e === 'PreToolUse' && !this.isDemo(s)) this.bumpMemory((CAT[evCat(ev)] || CAT.other).lobe, 1, true);
    const learnt = e === 'PreToolUse' ? this.learnTouch(s, a, ev, now) : null;
    this.countDaily(s, a, ev, now, took);
    const rec = this.record(ev, s, a, now);
    this.keepDetail(rec, ev, s, a, now);
    this.strike(rec, ev, s, a, now);
    this.watchStuck(s, a, ev, now);
    this.updateStatusBar();
    if (opts.replay) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE).concat(this.app.workspace.getLeavesOfType(VIEW_MINI))) {
      const v = leaf.view;
      if (v && typeof v.onBrainEvent === 'function') { v.onBrainEvent(ev, s, a, null, rec, learnt); v.requestHud(); }
    }
  }

  // events a server queued while the tunnel was down: apply them in order at their real times, then replay them quickly
  handleBatch(text, src) {
    const items = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const tab = line.indexOf('\t');
      const ts = tab > 0 ? Number(line.slice(0, tab)) : NaN;
      try { items.push({ ts: Number.isFinite(ts) ? Math.min(ts, Date.now()) : Date.now(), ev: JSON.parse(tab > 0 ? line.slice(tab + 1) : line) }); } catch (e) { /* skip a damaged line */ }
    }
    if (!items.length) return;
    items.sort((x, y) => x.ts - y.ts);
    for (const it of items) this.handleEvent(it.ev, { src, ts: it.ts, replay: true });
    this.history.sort((x, y) => x.t - y.t);
    const from = items[0].ts, to = items[items.length - 1].ts;
    this.noteSource(src, 'batch', Date.now(), items.length);
    new Notice(`Agent Brain: ${items.length} queued event${items.length > 1 ? 's' : ''} from ${src} (${fmtSpan(Math.max(60000, to - from))} while the tunnel was down). Replaying them now.`, 8000);
    this.forEachView(v => v.startReplay(from, Math.max(2, (to - from) / 12000), to + 1));
    this.updateStatusBar();
  }

  /* ---------- metabolism: Claude Code's own telemetry (model calls, tokens, cost) ---------- */

  handleOtelLogs(body, src) {
    const val = (v) => !v ? null : v.stringValue != null ? v.stringValue : v.intValue != null ? Number(v.intValue) : v.doubleValue != null ? Number(v.doubleValue) : v.boolValue != null ? !!v.boolValue : null;
    const attrs = (list) => { const o = {}; for (const x of list || []) o[x.key] = val(x.value); return o; };
    for (const rl of (body && body.resourceLogs) || []) {
      for (const sl of rl.scopeLogs || []) for (const lr of sl.logRecords || []) {
        const a = attrs(lr.attributes);
        const name = String(a['event.name'] || (lr.body && lr.body.stringValue) || '').replace(/^claude_code\./, '');
        const ns = String(lr.timeUnixNano || lr.observedTimeUnixNano || '');
        const t = ns.length > 6 ? Math.min(Date.now(), Number(ns.slice(0, -6)) || Date.now()) : Date.now();
        try { this.onOtel(name, a, t, src); } catch (e) { console.error('[agent-brain] telemetry', e); }
      }
    }
  }
  metabFor(sid) {
    if (!this.metab) this.metab = new Map();
    let M = this.metab.get(sid);
    if (!M) { M = { calls: 0, inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ms: 0, ctx: 0, model: '', errors: 0, lastAt: 0, hist: [] }; this.metab.set(sid, M); }
    return M;
  }
  onOtel(name, a, t, src) {
    const sid = String(a['session.id'] || '');
    if (!sid) return;
    const s = this.sessions.get(sid);
    const num = (k) => Number(a[k]) || 0;
    if (name === 'api_request') {
      const M = this.metabFor(sid);
      const inT = num('input_tokens'), out = num('output_tokens'), cr = num('cache_read_tokens'), cw = num('cache_creation_tokens');
      const cost = a.cost_usd != null ? num('cost_usd') : num('cost_usd_micros') / 1e6, ms = num('duration_ms');
      const agent = a['agent.name'] ? String(a['agent.name']) : '';
      M.calls++; M.inTok += inT; M.outTok += out; M.cacheRead += cr; M.cacheWrite += cw; M.cost += cost; M.ms += ms; M.lastAt = t;
      if (a.model) M.model = String(a.model);
      // the context of a main-thread call is the session's working memory
      if (!agent && !/compact|title|summar/i.test(String(a.query_source || ''))) M.ctx = inT + cr + cw;
      M.hist.push([t, out, inT + cr + cw]); if (M.hist.length > 120) M.hist.shift();
      if (s) {
        s.lastProgress = Math.max(s.lastProgress || 0, t);
        if (!this.isDemo(s)) {
          this.countTokens(s, inT + cr + cw, out, cost);
          // deliberation leaves its trace too: the bigger the output, the deeper the mark in prefrontal cortex
          const rec = { e: 'Thought', sid, n: M.calls, out, text: 'thinking' };
          const st = this.strikesFor(rec);
          this.deposit(st, t);
          this.remember(st, s, agent ? { type: agent } : null, t, 'Thought');
        }
      }
      this.forEachView(v => v.onMetabolism && v.onMetabolism(s, { inT, out, cr, cw, ms, cost, agent, model: a.model || '' }));
    } else if (name === 'api_error') {
      const M = this.metabFor(sid); M.errors++;
      if (s) { this.watchApiError(s, t, String(a.error || a.status_code || 'API error')); }
      this.forEachView(v => v.onApiError && v.onApiError(s, a));
    } else if (name === 'tool_result' && s) {
      s.lastProgress = Math.max(s.lastProgress || 0, t);
    }
  }
  countTokens(s, inT, out, cost) {
    const day = isoDay();
    if (!this.daily || this.daily.day !== day) return;
    const x = this.daily.sessions[s.id];
    if (!x) return;
    x.calls = (x.calls || 0) + 1; x.tokIn = (x.tokIn || 0) + inT; x.tokOut = (x.tokOut || 0) + out; x.cost = (x.cost || 0) + cost;
    this.dailyDirty = true;
  }
  tokensToday() {
    let i = 0, o = 0, c = 0;
    for (const x of Object.values((this.daily && this.daily.sessions) || {})) { i += x.tokIn || 0; o += x.tokOut || 0; c += x.cost || 0; }
    return { in: i, out: o, cost: c };
  }

  /* ---------- is it stuck? loops, repeated failures, a command that never ends, long silence ---------- */

  watchStuck(s, a, ev, now) {
    if (this._replaying || this.isDemo(s) && !this.demoStuck) return;
    const e = ev.hook_event_name, ti = ev.tool_input || {};
    const W = s.watch || (s.watch = { fails: [], cmds: new Map(), edits: new Map(), api: [] });
    const keyOf = () => String(ev.tool_name || '') + ':' + String(ti.command || ti.file_path || ti.url || ti.pattern || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const recent = (arr, ms) => { while (arr.length && now - arr[0] > ms) arr.shift(); return arr; };
    const who = a ? ` (${a.type})` : '';
    if (e === 'UserPromptSubmit' || e === 'Stop') { W.fails.length = 0; W.cmds.clear(); W.edits.clear(); this.clearAlarm(s); return; }
    if (e === 'PostToolUseFailure') {
      const k = keyOf();
      W.fails.push({ t: now, k });
      while (W.fails.length && now - W.fails[0].t > 10 * 60000) W.fails.shift();
      const same = W.fails.filter(f => f.k === k).length;
      const label = ev.tool_name === 'Bash' ? ((bashParts(String(ti.command || ''), 1)[0] || {}).cmd || 'command') : toolLabel(ev.tool_name) + (ti.file_path ? ' ' + baseName(ti.file_path) : '');
      if (same >= 3) this.raiseAlarm(s, 'loop:' + k, `${label} failed ${same} times in a row${who}`);
      else if (W.fails.filter(f => now - f.t < 5 * 60000).length >= 5) this.raiseAlarm(s, 'fails', `${W.fails.filter(f => now - f.t < 5 * 60000).length} failed tool calls in 5 minutes${who}`);
    } else if (e === 'PostToolUse') {
      // it worked: that command is no longer failing
      const k = keyOf(), cmd = String(ti.command || '').replace(/\s+/g, ' ').trim();
      W.fails = W.fails.filter(f => f.k !== k);
      if (s.alarm && (s.alarm.key === 'loop:' + k || s.alarm.key === 'repeat:' + cmd)) this.clearAlarm(s);
    } else if (e === 'PreToolUse') {
      // the same command again and again with nothing changed in between (an edit resets the count)
      if (ev.tool_name === 'Bash' && ti.command) {
        const k = String(ti.command).replace(/\s+/g, ' ').trim();
        const arr = recent(W.cmds.get(k) || [], 10 * 60000); arr.push(now); W.cmds.set(k, arr);
        if (W.cmds.size > 200) W.cmds.delete(W.cmds.keys().next().value);
        if (arr.length >= 4) this.raiseAlarm(s, 'repeat:' + k, `Ran the same ${(bashParts(k, 1)[0] || {}).cmd || 'command'} command ${arr.length} times without changing anything${who}`);
      }
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(ev.tool_name || '')) W.cmds.clear();
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(ev.tool_name || '') && (ti.file_path || ti.notebook_path)) {
        const f = String(ti.file_path || ti.notebook_path);
        const arr = recent(W.edits.get(f) || [], 10 * 60000); arr.push(now); W.edits.set(f, arr);
        if (W.edits.size > 200) W.edits.delete(W.edits.keys().next().value);
        if (arr.length >= 12) this.raiseAlarm(s, 'edit:' + f, `Edited ${baseName(f)} ${arr.length} times in 10 minutes${who}`);
      }
    } else if (e === 'StopFailure') this.watchApiError(s, now, String(ev.error_type || 'error').replace(/_/g, ' '));
  }
  watchApiError(s, t, what) {
    const W = s.watch || (s.watch = { fails: [], cmds: new Map(), edits: new Map(), api: [] });
    W.api.push(t); while (W.api.length && t - W.api[0] > 3 * 60000) W.api.shift();
    if (W.api.length >= 3) this.raiseAlarm(s, 'api', `${W.api.length} API errors in 3 minutes (${clip(what, 40)})`);
  }
  // every 10 s: a command that has been running for very long, or no sign of progress while "thinking"
  tickStuck() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (this.isDemo(s) && !this.demoStuck) continue;
      if (s.alarm && now - s.alarm.at > 15 * 60000) this.clearAlarm(s);
      if (!this.isLive(s) || (s.wait && s.wait.kind === 'approval')) continue;
      const last = Math.max(s.at || 0, s.lastProgress || 0, s.speakAt || 0);
      if (s.phase === 'tool' && now - s.since > 20 * 60000) this.raiseAlarm(s, 'hang', `${clip(s.state, 40)} has been running for ${fmtDur(now - s.since)}`);
      else if (s.phase === 'thinking' && now - last > 10 * 60000) this.raiseAlarm(s, 'silent', `No progress for ${Math.round((now - last) / 60000)} minutes`);
    }
  }
  raiseAlarm(s, key, text) {
    const now = Date.now();
    const same = s.alarm && s.alarm.key === key;
    s.alarm = { key, text, since: same ? s.alarm.since : now, at: now, notified: same ? s.alarm.notified : false };
    if (!s.alarm.notified && this.settings.notifyStuck) { this.alert(s, 'may be stuck', text); s.alarm.notified = true; }
    this.forEachView(v => { if (v.onAlarm) v.onAlarm(s); if (v.requestHud) v.requestHud(); });
  }
  clearAlarm(s) { if (!s.alarm) return; s.alarm = null; this.forEachView(v => v.requestHud && v.requestHud()); }

  /* ---------- body signals: CPU, memory, network and disk of each machine ---------- */

  startVitals() {
    this.stopVitals();
    let os = null;
    try { os = require('os'); } catch (e) { return; }
    if (!os || typeof os.cpus !== 'function') return;
    let prev = null;
    const sample = () => {
      if (!this.settings.vitals) { prev = null; return; }
      const cpus = os.cpus() || [];
      let idle = 0, total = 0;
      for (const c of cpus) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
      if (prev && total > prev.total) this.noteVitals('local', { cpu: Math.max(0, Math.min(1, 1 - (idle - prev.idle) / (total - prev.total))), mem: 1 - os.freemem() / os.totalmem(), ncpu: cpus.length });
      prev = { idle, total };
    };
    sample();
    this.vitalTimer = window.setInterval(sample, 2000);
  }
  stopVitals() { if (this.vitalTimer) window.clearInterval(this.vitalTimer); this.vitalTimer = null; }
  noteVitals(src, v) {
    const x = this.vitals.get(src) || { name: src, hist: [] };
    Object.assign(x, v, { t: Date.now() });
    x.hist.push(x.cpu || 0); if (x.hist.length > 60) x.hist.shift();
    this.vitals.set(src, x);
  }
  // the machine the brain stem follows: the one where Claude is working right now, else the busiest
  vitalsNow() {
    const now = Date.now();
    let best = null, bw = -1;
    for (const x of this.vitals.values()) {
      if (now - x.t > 15000) continue;
      let w = x.cpu || 0;
      for (const s of this.sessions.values()) if ((s.src || 'local') === x.name && this.isLive(s)) w += 2;
      if (w > bw) { bw = w; best = x; }
    }
    return best ? { name: best.name, cpu: best.cpu || 0, mem: best.mem || 0, net: (best.rx || 0) + (best.tx || 0), disk: (best.rd || 0) + (best.wr || 0) } : null;
  }
  freshVitals() { const now = Date.now(); return [...this.vitals.values()].filter(x => now - x.t < 15000).sort((a, b) => (a.name === 'local' ? 0 : 1) - (b.name === 'local' ? 0 : 1)); }

  /* ---------- connections: which machines are sending, is the tunnel up ---------- */

  noteSource(name, kind, t, n) {
    t = t || Date.now();
    let x = this.sources.get(name);
    if (!x) { x = { name, lastEvent: 0, lastBeat: 0, events: 0, batches: 0, queued: 0, down: false }; this.sources.set(name, x); }
    if (kind === 'beat') {
      if (x.down) { x.down = false; new Notice(`Agent Brain: tunnel to ${name} is back up.`, 5000); }
      x.lastBeat = t;
    } else if (kind === 'batch') { x.batches++; x.queued += n || 0; }
    else { x.events++; x.lastEvent = Math.max(x.lastEvent, t); }
  }
  sourceState(x) {
    const now = Date.now();
    if (x.lastBeat) return now - x.lastBeat < 50000 ? 'up' : 'down';
    return now - x.lastEvent < 10 * 60000 ? 'live' : 'quiet';
  }
  tickSources() {
    for (const x of this.sources.values()) {
      if (x.lastBeat && !x.down && Date.now() - x.lastBeat > 60000) {
        x.down = true;
        new Notice(`Agent Brain: tunnel to ${x.name} is down. The server keeps its events and sends them when it reconnects.`, 8000);
      }
    }
  }

  /* ---------- what each event does to the brain: strikes, kept per tool call so the result can travel back ---------- */

  strike(rec, ev, s, a, now) {
    const e = rec.e, id = ev.tool_use_id ? String(ev.tool_use_id) : '';
    let strikes, scale = a ? 0.7 : 1;
    if (e === 'PostToolUse' || e === 'PostToolUseFailure' || e === 'PermissionDenied') {
      const pre = (id && s.calls && s.calls.get(id)) || this.strikesFor(Object.assign({}, rec, { e: 'PreToolUse' }));
      if (id && s.calls) s.calls.delete(id);
      if (e === 'PostToolUse') { strikes = pre; scale *= 0.3; }         // finishing strengthens the same trace a little
      else { rec.pre = pre; strikes = this.strikesFor(rec); }
    } else strikes = this.strikesFor(rec);
    if (e === 'PreToolUse') {
      if (!a) s.lastPre = rec;
      if (!s.calls) s.calls = new Map();
      if (id) { s.calls.set(id, strikes); if (s.calls.size > 200) s.calls.delete(s.calls.keys().next().value); }
      if (!a) s.lastStrikes = strikes;
    }
    rec.strikes = strikes;
    if (!strikes.length) return;
    // demo sessions light the brain up but don't leave anything in your stored trace
    if (this.isDemo(s)) { const f0 = this.engScale(now) * scale; this.forEachView(v => v.onEngram && v.onEngram(strikes, f0)); }
    else {
      this.deposit(strikes, now, scale);
      if (e !== 'PostToolUse') this.remember(strikes, s, a, now, e);
    }
  }

  /* ---------- region memory: what happened in each gyrus and nucleus (short labels only, never command lines) ---------- */

  remember(strikes, s, a, t, e) {
    const M = this.regionMem || (this.regionMem = {});
    const who = this.sessionLabel(s) + (a ? ' › ' + a.type : '');
    const push = (key, st) => {
      const L = M[key] || (M[key] = []);
      const last = L[L.length - 1];
      if (last && last[1] === st.kind && last[4] === st.what && last[2] === who && t - last[0] < 60000) { last[0] = t; last[5] = (last[5] || 1) + 1; return; }
      L.push([t, st.kind, who, s.color || SIGNAL, st.what || '', 1, e === 'PostToolUseFailure' || e === 'PermissionDenied' || e === 'StopFailure' ? 1 : 0]);
      if (L.length > 24) L.splice(0, L.length - 24);
    };
    for (const st of strikes) { push(String(st.label), st); if (st.nucleus) push('n:' + st.nucleus, st); }
    this.memDirty = true;
  }
  pruneRegionMem() {
    const cut = Date.now() - 3 * 24 * 3600 * 1000;
    for (const k of Object.keys(this.regionMem)) { const L = this.regionMem[k].filter(x => x[0] > cut); if (L.length) this.regionMem[k] = L; else delete this.regionMem[k]; }
  }

  // MessageDisplay: Claude's reply streaming to the screen, chunk by chunk. The length drives the brain; the text is
  // kept in memory only (with "Full call details" on), so the inspector can show what Claude said before each call.
  onSpeech(s, ev, now, opts) {
    const chunk = String(ev.display_content != null ? ev.display_content : ev.text || ''), n = chunk.length;
    if (this.settings.callDetails !== false && !this.isDemo(s)) {
      if (s.saidSeal || !s.said) { s.said = ''; s.saidSeal = false; }
      s.said = typeof ev.accumulated_text === 'string' && ev.accumulated_text.length >= s.said.length ? ev.accumulated_text : s.said + chunk;
      if (s.said.length > 12000) s.said = '…' + s.said.slice(-12000);
    }
    s.at = Math.max(s.at, now); s.speakAt = now; s.speakN = (s.speakN || 0) + n;
    if (s.busy && !s.wait && !s.inflight && s.state !== 'writing') s.state = 'writing';
    if (!s._speak || (this.geo && !s._speak[0].fibre)) s._speak = this.strikesFor({ e: 'Message', sid: s.id, n: 0 });
    if (n && !this.isDemo(s)) this.deposit(s._speak.map(st => Object.assign({}, st, { w: n / 2500 })), now);
    if (ev.is_final_chunk) this.endSpeech(s, now);
    if (opts && opts.replay) return;
    this.forEachView(v => v.onSpeech && v.onSpeech(s, n, s._speak));
  }
  endSpeech(s, now) {
    const r = this.record({ hook_event_name: 'Message', session_id: s.id }, s, null, now);
    r.n = s.speakN || 0; r.text = `${r.n.toLocaleString('en-US')} characters`;
    s.speakN = 0;
    r.strikes = s._speak || [];
    if (s.said) this.keepDetail(r, { hook_event_name: 'Message', session_id: s.id, text: s.said }, s, null, now);
    if (!this._replaying) this.forEachView(v => v.pushLog && v.pushLog({ hook_event_name: 'Message' }, '', s, null, { text: r.text }));
  }

  /* ---------- full call details: every field Claude Code sends, kept in memory for the inspector, never on disk ---------- */

  keepDetail(rec, ev, s, a, now) {
    if (this.settings.callDetails === false || !rec || !ev) return;
    const D = this.details || (this.details = new WeakMap()), Q = this.detailQ || (this.detailQ = []);
    const lim = { left: DETAIL_CALL };
    const d = { ev: capDeep(ev, lim, 0) };
    if (ev.permission_mode) s.mode = String(ev.permission_mode);
    if (rec.e === 'PreToolUse') {
      d.mode = s.mode || '';
      if (!a) {
        // what Claude said just before it made this call (calls made together share it), and the step of its plan
        if (s.said && !s.saidSeal) d.said = s.said;
        const pl = this.plan(s);
        if (pl && pl.current && !/^(next: |all tasks done)/.test(pl.current)) d.step = pl.current;
      }
    }
    if (a) d.agent = { id: a.id, type: a.type, spawn: a.spawn || '', parent: a.parent || '', wf: !!a.wf, desc: a.desc || '' };
    d.n = DETAIL_CALL - lim.left + 200;
    const old = D.get(rec);
    D.set(rec, d); Q.push([rec, d.n]);
    this.detailN = (this.detailN || 0) + d.n - (old ? old.n : 0);
    while (Q.length && (this.detailN > DETAIL_BUDGET || Q.length > 8000)) { const [r0, n0] = Q.shift(); if (D.get(r0) && D.get(r0).n === n0) { D.delete(r0); this.detailN -= n0; } }
  }
  detailOf(rec) { return rec && this.details ? this.details.get(rec) || null : null; }
  clearDetails() { this.details = new WeakMap(); this.detailQ = []; this.detailN = 0; for (const s of this.sessions.values()) { s.said = ''; } }

  /* ---------- history (timeline, replay, focus panel) ---------- */

  record(ev, s, a, now) {
    const e = ev.hook_event_name;
    const cat = ev.tool_name ? evCat(ev) : '';
    const ti = ev.tool_input || {};
    const r = {
      t: now, sid: s.id, e, tool: ev.tool_name || '', cat, lobe: cat ? (CAT[cat] || CAT.other).lobe : '',
      aid: a ? a.id : '', agent: a ? a.type : '', wf: a ? a.wf : false,
      text: eventText(ev), file: ti.file_path || ti.notebook_path || ti.path || ev.file_path || ev.new_cwd || ev.directory_path || ev.worktree_path || '',
      cwd: ev.cwd || '', ntype: ev.notification_type || '',
      color: s.color, label: this.sessionLabel(s), idx: s.idx, src: s.src || 'local',
    };
    // each command of a shell pipeline or chain, by program name only (the command line itself is not kept)
    if (e === 'PreToolUse' && ev.tool_name === 'Bash' && ti.command) { const parts = bashParts(String(ti.command)); if (parts.length > 1) r.parts = parts.map(pt => [pt.cat, pt.cmd]); }
    if (e === 'PreToolUse' && !r.file) r.key = ti.url || ti.query || ti.pattern || ti.subagent_type || ti.command || ti.description || '';
    if (e === 'PostToolUse') r.size = responseSize(ev.tool_response);
    if (ev.tool_use_id) r.id = String(ev.tool_use_id);
    const h = this.history;
    h.push(r);
    if (h.length > 1 && h[h.length - 2].t > now) h.sort((x, y) => x.t - y.t);
    if (h.length > 40000) h.splice(0, 4000);
    return r;
  }
  pruneHistory() {
    const cut = Date.now() - HISTORY_MS;
    let i = 0; while (i < this.history.length && this.history[i].t < cut) i++;
    if (i) this.history.splice(0, i);
  }

  /* ---------- learning: files used together get wired together ---------- */

  decayW(x, now) { return x.w * Math.pow(0.5, Math.max(0, (now || Date.now()) - x.t) / LEARN_HALF_LIFE); }
  learnKey(s, ev) {
    const ti = ev.tool_input || {};
    const fp = ti.file_path || ti.notebook_path;
    if (!fp || typeof fp !== 'string') return null;
    const rel = this.toVaultRel(fp, ev.cwd);
    if (rel !== null && /\.md$/i.test(rel)) return { key: 'n:' + rel };
    const c = normPath(ev.cwd || ''), p = normPath(fp);
    const inCwd = c && p.toLowerCase().startsWith(c.toLowerCase() + '/');
    const proj = rel !== null ? (this.app.vault.getName ? this.app.vault.getName() : 'vault') : (s.project || 'files');
    const relp = rel !== null ? rel : inCwd ? p.slice(c.length + 1) : p.replace(/^[a-zA-Z]:/, '');
    return { key: 'f:' + proj + ':' + relp, proj, relp };
  }
  learnTouch(s, a, ev, now) {
    if (!this.settings.learning || this.isDemo(s) && !this.demoLearn) return null;
    const k = this.learnKey(s, ev);
    if (!k) return null;
    const L = this.learned, key = k.key;
    let grew = false;
    if (key.startsWith('f:')) {
      let nn = L.neurons[key];
      if (!nn) { nn = L.neurons[key] = { name: baseName(k.relp), path: k.relp, proj: k.proj, lobe: (CAT[evCat(ev)] || CAT.other).lobe, w: 0, t: now, n: 0 }; grew = true; }
      nn.w = Math.min(10, this.decayW(nn, now) + 1); nn.t = now; nn.n++;
    }
    const holder = a || s;
    let syn = null;
    if (holder.lastKey && holder.lastKey !== key && now - holder.lastKeyAt < 120000) {
      const x = holder.lastKey < key ? holder.lastKey : key, y = holder.lastKey < key ? key : holder.lastKey;
      const sk = x + '|' + y;
      let sy = L.synapses[sk];
      if (!sy) { sy = L.synapses[sk] = { a: x, b: y, w: 0, t: now, n: 0 }; grew = true; }
      sy.w = Math.min(10, this.decayW(sy, now) + 1); sy.t = now; sy.n++;
      syn = { a: x, b: y, isNew: sy.n === 1 };
    }
    holder.lastKey = key; holder.lastKeyAt = now;
    this.memDirty = true;
    if (grew) this.forEachView(v => v.scheduleRebuild());
    return { key, syn, grew };
  }
  pruneLearned() {
    const L = this.learned, now = Date.now();
    for (const k in L.synapses) if (this.decayW(L.synapses[k], now) < 0.25) delete L.synapses[k];
    for (const k in L.neurons) if (this.decayW(L.neurons[k], now) < 0.25) delete L.neurons[k];
    const cap = (obj, n) => { const ks = Object.keys(obj); if (ks.length <= n) return; ks.sort((p, q) => this.decayW(obj[p], now) - this.decayW(obj[q], now)); for (const k of ks.slice(0, ks.length - n)) delete obj[k]; };
    cap(L.neurons, 600); cap(L.synapses, 2500);
    for (const k in L.synapses) { const y = L.synapses[k]; if ((y.a.startsWith('f:') && !L.neurons[y.a]) || (y.b.startsWith('f:') && !L.neurons[y.b])) delete L.synapses[k]; }
  }
  resetLearned() {
    this.learned = { neurons: {}, synapses: {} };
    this.saveAll();
    this.forEachView(v => v.scheduleRebuild(0));
    new Notice('Agent Brain: learned connections cleared.');
  }

  /* ---------- daily activity note ---------- */

  countDaily(s, a, ev, now, took) {
    if (this.isDemo(s)) return;
    const day = isoDay(new Date(now));
    if (!this.daily || this.daily.day !== day) {
      if (this.daily && this.daily.day < day) { this.writeDailyNote(this.daily); this.daily = { day, sessions: {} }; }
      else if (!this.daily) this.daily = { day, sessions: {} };
    }
    const D = this.daily;
    let x = D.sessions[s.id];
    if (!x) x = D.sessions[s.id] = { label: s.project || 'session', src: s.src || 'local', first: now, last: now, prompts: 0, tools: {}, agents: 0, workflows: 0, tasksDone: 0, failures: 0, busyMs: 0, files: {} };
    x.first = Math.min(x.first, now); x.last = Math.max(x.last, now);
    if (s.project) x.label = s.project;
    const e = ev.hook_event_name, ti = ev.tool_input || {};
    if (e === 'UserPromptSubmit') x.prompts++;
    else if (e === 'PreToolUse') {
      const cat = evCat(ev);
      x.tools[cat] = (x.tools[cat] || 0) + 1;
      if (ev.tool_name === 'Workflow') x.workflows++;
      if (ev.tool_name === 'TaskUpdate' && ti.status === 'completed') x.tasksDone++;
      const k = this.learnKey(s, ev);
      if (k) {
        const label = k.key.startsWith('n:') ? k.key.slice(2) : (k.relp || k.key);
        if (x.files[label] || Object.keys(x.files).length < 300) x.files[label] = (x.files[label] || 0) + 1;
      }
    } else if (e === 'SubagentStart' && a) x.agents++;
    else if (e === 'PostToolUseFailure') x.failures++;
    else if (e === 'Stop' && took > 0) x.busyMs += took;
    this.dailyDirty = true;
  }

  dailyPath(day) {
    const folder = String(this.settings.dailyFolder || 'Claude Activity').replace(/^\/+|\/+$/g, '');
    return (folder ? folder + '/' : '') + day + '.md';
  }

  renderDailyNote(D, keep) {
    const S = Object.values(D.sessions).sort((p, q) => q.last - p.last);
    const sum = (f) => S.reduce((n, x) => n + f(x), 0);
    const calls = (x) => Object.values(x.tools).reduce((n, v) => n + v, 0);
    const date = new Date(D.day + 'T12:00:00');
    const L = [];
    L.push('---', 'type: claude-activity', 'date: ' + D.day, 'sessions: ' + S.length, 'prompts: ' + sum(x => x.prompts),
      'tool_calls: ' + sum(calls), 'active: ' + fmtSpan(sum(x => x.busyMs)), 'lobe: cerebellum', '---', '');
    L.push('# Claude activity · ' + date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), '');
    L.push('> [!info] Written by the Agent Brain plugin and refreshed every 10 minutes. Anything under "## My notes" is kept.', '');
    const tok = S.some(x => x.calls);
    L.push('| Session | Source | Active | Prompts | Tool calls | Subagents | Workflows | Tasks done | Failures |' + (tok ? ' Model calls | Tokens in / out | Cost |' : ''), '|---|---|---:|---:|---:|---:|---:|---:|---:|' + (tok ? '---:|---:|---:|' : ''));
    for (const x of S) L.push(`| ${x.label} | ${x.src} | ${fmtSpan(x.busyMs)} | ${x.prompts} | ${calls(x)} | ${x.agents} | ${x.workflows} | ${x.tasksDone} | ${x.failures} |` + (tok ? ` ${x.calls || 0} | ${fmtTok(x.tokIn || 0)} / ${fmtTok(x.tokOut || 0)} | $${(x.cost || 0).toFixed(2)} |` : ''));
    L.push('');
    for (const x of S) {
      L.push('## ' + x.label, '');
      const tools = Object.entries(x.tools).sort((p, q) => q[1] - p[1]).map(([k, v]) => `${(CAT[k] || CAT.other).tag.toLowerCase()} ${v}`).join(' · ');
      L.push(`**Activity:** ${hhmm(x.first)}–${hhmm(x.last)} · **Tools:** ${tools || '–'}`, '');
      const files = Object.entries(x.files).sort((p, q) => q[1] - p[1]).slice(0, 20);
      if (files.length) {
        L.push('**Files it worked with**');
        for (const [f, n] of files) L.push(/\.md$/i.test(f) && !f.includes(':') && this.app.vault.getAbstractFileByPath(f) ? `- [[${f.replace(/\.md$/i, '')}]] · ${n}` : `- \`${f}\` · ${n}`);
        L.push('');
      }
    }
    L.push('## My notes', '');
    if (keep) L.push(keep);
    return L.join('\n');
  }

  async writeDailyNote(D, open) {
    D = D || this.daily;
    if (!this.settings.dailyNote || !D || !Object.keys(D.sessions).length) return null;
    const path = this.dailyPath(D.day);
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    try {
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const f = this.app.vault.getAbstractFileByPath(path);
      let keep = '';
      if (f) { const cur = await this.app.vault.read(f); const i = cur.indexOf('## My notes'); if (i >= 0) keep = cur.slice(i + '## My notes'.length).replace(/^\s+/, ''); }
      const md = this.renderDailyNote(D, keep);
      if (f) { const cur = await this.app.vault.read(f); if (cur !== md) await this.app.vault.modify(f, md); }
      else await this.app.vault.create(path, md);
      if (D === this.daily) this.dailyDirty = false;
      if (open) await this.app.workspace.openLinkText(path, '', true);
      return path;
    } catch (e) { console.error('[agent-brain] daily note', e); return null; }
  }

  /* ---------- subagents, workflows and the task list ---------- */

  onAgentEvent(s, ev, id) {
    const now = (this._now || Date.now()), e = ev.hook_event_name;
    let a = s.agents.get(id);
    if (!a) {
      a = { id, type: String(ev.agent_type || 'agent'), desc: '', start: now, lastAt: now, last: 'starting', tools: 0, done: false, wf: false, inTool: false };
      // label it with the Agent tool call that spawned it; agents nobody asked for by hand belong to the running workflow
      s.pending = s.pending.filter(p => now - p.at < 120000);
      const i = s.pending.findIndex(p => !p.type || p.type === a.type);
      if (i >= 0) { a.desc = s.pending[i].desc; a.spawn = s.pending[i].id || ''; a.parent = s.pending[i].by || ''; s.pending.splice(i, 1); }
      else if (s.workflow && s.workflow.active) { a.wf = true; a.spawn = s.workflow.id || ''; s.workflow.started++; }
      s.agents.set(id, a);
    }
    if (ev.agent_type) a.type = String(ev.agent_type);
    a.lastAt = now;
    switch (e) {
      case 'PreToolUse': {
        a.tools++; a.last = describe(ev); a.inTool = true; a.lobe = (CAT[evCat(ev)] || CAT.other).lobe;
        // an agent starting an agent of its own: remember who asked, for the lineage in the inspector
        if (/^(Agent|Task)$/.test(ev.tool_name || '')) { const ti = ev.tool_input || {}; s.pending.push({ desc: clip(ti.description || '', 48), type: ti.subagent_type ? String(ti.subagent_type) : '', at: now, id: ev.tool_use_id ? String(ev.tool_use_id) : '', by: id }); }
        break;
      }
      case 'PostToolUse': case 'PostToolUseFailure': a.inTool = false; break;
      case 'SubagentStop':
        if (!a.done) { a.done = true; a.doneAt = now; a.last = 'done'; if (a.wf && s.workflow) s.workflow.done++; }
        break;
      default: break;
    }
    if (a.wf && s.workflow) s.workflow.lastAt = now;
    return a;
  }

  agentLabel(s, a) { return a ? this.sessionLabel(s) + ' › ' + (a.type || 'agent') : this.sessionLabel(s); }
  runningAgents(s) { return s && s.agents ? [...s.agents.values()].filter(a => !a.done && Date.now() - a.lastAt < STALE) : []; }

  // TodoWrite (older) or TaskCreate/TaskUpdate (newer): keep "what step of the plan is it on"
  trackPlan(s, ev) {
    const ti = ev.tool_input || {}, name = ev.tool_name, now = (this._now || Date.now());
    if (ev.hook_event_name === 'PreToolUse') {
      if (name === 'TodoWrite' && Array.isArray(ti.todos)) { s.todo = ti.todos.map(t => ({ subject: String(t.activeForm && t.status === 'in_progress' ? t.activeForm : t.content || ''), status: String(t.status || 'pending') })); s.planAt = now; }
      else if (name === 'TaskCreate') { s.taskQueue.push(String(ti.subject || ti.title || ti.description || 'task')); }
      else if (name === 'TaskUpdate') {
        const id = String(ti.taskId != null ? ti.taskId : ti.id != null ? ti.id : '');
        if (!id) return;
        const t = s.tasks.get(id) || { subject: '#' + id, status: 'pending' };
        if (ti.subject) t.subject = String(ti.subject);
        if (ti.status) t.status = String(ti.status);
        if (ti.status === 'in_progress' && ti.activeForm) t.subject = String(ti.activeForm);
        s.tasks.set(id, t); s.planAt = now;
      } else if (name === 'Agent' || name === 'Task') {
        s.pending.push({ desc: clip(ti.description || '', 48), type: ti.subagent_type ? String(ti.subagent_type) : '', at: now, id: ev.tool_use_id ? String(ev.tool_use_id) : '', by: '' });
      } else if (name === 'Workflow') {
        s.workflow = { name: workflowName(ti), since: now, lastAt: now, active: true, started: 0, done: 0, id: ev.tool_use_id ? String(ev.tool_use_id) : '' };
      }
    } else if (name === 'TaskCreate') {
      const subject = s.taskQueue.shift() || 'task';
      const r = typeof ev.tool_response === 'string' ? ev.tool_response : JSON.stringify(ev.tool_response || '');
      const m = r.match(/#(\d+)/) || r.match(/"(?:id|taskId|task_id)"\s*:\s*"?(\w+)/);
      const id = m ? m[1] : 'n' + s.tasks.size;
      if (!s.tasks.has(id)) s.tasks.set(id, { subject, status: 'pending' });
      s.planAt = now;
    }
  }

  plan(s) {
    let list = s.tasks && s.tasks.size ? [...s.tasks.values()].filter(t => t.status !== 'deleted') : s.todo;
    if (!list || !list.length) return null;
    const done = list.filter(t => t.status === 'completed').length;
    if (done === list.length && Date.now() - s.planAt > 120000) return null;
    const cur = list.filter(t => t.status === 'in_progress').pop();
    return { done, total: list.length, current: cur ? cur.subject : done === list.length ? 'all tasks done' : 'next: ' + (list.find(t => t.status !== 'completed') || {}).subject };
  }

  tickAgents() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      for (const [id, a] of s.agents) {
        if ((a.done && now - a.doneAt > 5 * 60000) || (!a.done && now - a.lastAt > STALE)) s.agents.delete(id);
      }
      const w = s.workflow;
      if (w && w.active) {
        const running = [...s.agents.values()].filter(a => a.wf && !a.done).length;
        if ((w.started > 0 && running === 0 && now - w.lastAt > 60000) || (w.started === 0 && now - w.since > 10 * 60000)) { w.active = false; w.endedAt = now; }
      }
      if (w && !w.active && now - w.endedAt > 90000) s.workflow = null;
    }
  }

  onNotification(s, ev) {
    const type = String(ev.notification_type || '');
    const msg = String(ev.message || '');
    const now = (this._now || Date.now());
    let kind = null;
    if (type === 'permission_prompt' || type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input' || (!type && /permission|approv/i.test(msg))) kind = 'approval';
    else if (type === 'idle_prompt' || (!type && /waiting for your input/i.test(msg))) kind = 'input';
    if (!kind) return;                                   // auth_success and other informational notices
    if (kind === 'approval') {
      if (s.wait && s.wait.kind === 'approval' && now - s.wait.since < 20000) { if (msg.length > (s.wait.msg || '').length) s.wait.msg = msg; return; }
      s.wait = { kind, since: now, msg, notified: false, agent: ev.agent_id ? String(ev.agent_id) : '' };
      s.state = 'needs approval'; s.busy = false; s.phase = 'waiting'; s.since = now;
      if (this.settings.notifyApproval) { this.alert(s, 'needs your approval', msg); s.wait.notified = true; }
    } else {
      if (!s.wait || s.wait.kind !== 'input') s.wait = { kind, since: now, msg, notified: false };
      s.state = 'your turn'; s.busy = false; s.phase = 'idle';
      if (!s.wait.notified && this.settings.notifyReply) { this.alert(s, 'is waiting for your reply', msg); s.wait.notified = true; }
    }
  }

  alert(s, what, detail) {
    if (this._replaying) return;              // queued events are history, not something to act on now
    const demo = this.isDemo(s);
    const title = `Claude · ${this.sessionLabel(s)} ${what}${demo ? ' (demo)' : ''}`;
    const body = clip(detail || '', 160);
    new Notice(body ? `${title}\n${body}` : title, 10000);
    if (demo || !this.settings.desktopNotify || document.hasFocus()) return;
    try { if (window.Notification) new window.Notification(title, { body, silent: false }); } catch (e) { /* not available */ }
  }

  pickColor() {
    const used = new Set([...this.sessions.values()].map(s => s.color));
    return SESSION_COLORS.find(c => !used.has(c)) || SESSION_COLORS[this.sessionSeq % SESSION_COLORS.length];
  }
  sessionLabel(s) {
    if (s.label) return s.label;
    const name = s.project || 'session';
    let dup = 0;
    for (const o of this.sessions.values()) if (o !== s && (o.project || 'session') === name) dup++;
    return dup ? `${name}·${s.id.replace(/[^a-z0-9]/gi, '').slice(0, 4)}` : name;
  }
  forEachView(fn) { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE).concat(this.app.workspace.getLeavesOfType(VIEW_MINI))) if (leaf.view && leaf.view.renderer) fn(leaf.view); }
  isDemo(s) { return !!(s && String(s.id).startsWith('demo-')); }
  isLocal(ev) { return !!(ev && ev.cwd) && this.toVaultRel(ev.cwd, '') !== null; }
  // a session counts as working while it is mid-turn and has been heard from recently
  isLive(s) { return !!s && s.busy && (s.phase === 'thinking' || s.phase === 'tool' || s.phase === 'compacting') && Date.now() - s.at < STALE; }
  anyLive() { for (const s of this.sessions.values()) if (this.isLive(s) || (s.wait && s.wait.kind === 'approval') || (s.workflow && s.workflow.active)) return true; return false; }

  eventsPerMinute() {
    const cut = Date.now() - 60000;
    this.eventTimes = this.eventTimes.filter(t => t > cut);
    return this.eventTimes.length;
  }
  activeSessions() { return [...this.sessions.values()].sort((a, b) => a.idx - b.idx).slice(0, 6); }
  anyBusy() { for (const s of this.sessions.values()) if (this.isLive(s)) return true; return false; }
  pruneSessions() {
    const now = Date.now();
    for (const [k, s] of this.sessions) if (now - s.at > 90 * 60 * 1000) this.sessions.delete(k);
    this.updateStatusBar();
  }
  updateStatusBar() {
    if (!this.statusBar) return;
    const list = this.sessions ? [...this.sessions.values()] : [];
    const n = list.length;
    const waiting = list.filter(s => s.wait && s.wait.kind === 'approval').length;
    const working = list.filter(s => this.isLive(s)).length;
    const agents = list.reduce((n, s) => n + this.runningAgents(s).length, 0);
    const down = this.sources ? [...this.sources.values()].filter(x => this.sourceState(x) === 'down').map(x => x.name) : [];
    let txt;
    if (!this.serverOk) txt = 'offline';
    else if (down.length) txt = `${down.join(', ')} tunnel down`;
    else if (waiting) txt = `${waiting} waiting for you`;
    else if (working) txt = `${working} working`;
    else if (agents) txt = `${agents} agent${agents > 1 ? 's' : ''} working`;
    else txt = 'idle';
    if (this.serverOk && !waiting && working && agents) txt += ` · ${agents} agent${agents > 1 ? 's' : ''}`;
    this.statusBar.setText(`Claude · ${n > 1 ? n + ' sessions · ' : ''}${txt}`);
    this.statusBar.toggleClass('cb-sb-wait', waiting > 0 || down.length > 0);
    this.statusBar.setAttr('title', 'Open Agent Brain');
  }

  toVaultRel(p, cwd) {
    if (!p || typeof p !== 'string') return null;
    let s = normPath(p);
    if (!/^[a-zA-Z]:\//.test(s) && !s.startsWith('/')) {
      const c = normPath(cwd || '');
      if (!c) return null;
      s = c + '/' + s.replace(/^\.\//, '');
    }
    const base = normPath(this.app.vault.adapter.basePath || '');
    if (!base) return null;
    const ls = s.toLowerCase(), lb = base.toLowerCase();
    if (ls === lb) return '';
    if (ls.startsWith(lb + '/')) return s.slice(base.length + 1);
    return null;
  }

  hookCommand() {
    return `curl -s -m 1 -o /dev/null -H "Content-Type: application/json" --data-binary @- http://127.0.0.1:${this.settings.port}/event || true`;
  }
  // every hook event that says something about what Claude is doing (WorktreeCreate/Remove are left out on purpose:
  // a hook there replaces how worktrees are made). MessageDisplay fires per streamed chunk, so it uses a plain HTTP hook.
  hooksConfig() {
    const port = Number(this.settings.port) || DEFAULTS.port;
    const h = [{ type: 'command', command: this.hookCommand(), timeout: 3 }];
    const out = {};
    for (const e of HOOK_TOOL_EVENTS) out[e] = [{ matcher: '*', hooks: h }];
    for (const e of HOOK_EVENTS) out[e] = [{ hooks: h }];
    if (this.settings.speechHook !== false) out.MessageDisplay = [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/event`, timeout: 2 }] }];
    return out;
  }
  hooksJson() { return JSON.stringify({ hooks: this.hooksConfig() }, null, 2); }

  // writes the hooks into ~/.claude/settings.json on this computer (keeps your other hooks, makes a backup first)
  async installLocalHooks() {
    let fs, path, os;
    try { fs = require('fs'); path = require('path'); os = require('os'); } catch (e) { new Notice('Agent Brain: no file access here.'); return; }
    const port = Number(this.settings.port) || DEFAULTS.port;
    const mine = (g) => (g && Array.isArray(g.hooks) ? g.hooks : []).some(x => /27182\/event|brain-hook\.sh/.test(String(x.command || '') + String(x.url || '')) || String(x.command || '').includes(`:${port}/event`) || String(x.url || '').includes(`:${port}/event`));
    const strip = (hooks) => { let n = 0; for (const e of Object.keys(hooks || {})) { if (!Array.isArray(hooks[e])) continue; const keep = hooks[e].filter(g => !mine(g)); n += hooks[e].length - keep.length; if (keep.length) hooks[e] = keep; else delete hooks[e]; } return n; };
    const dir = path.join(os.homedir(), '.claude'), file = path.join(dir, 'settings.json');
    let cfg = {}, telemetry = 'off';
    try { if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); }
    catch (e) { new Notice(`Agent Brain: could not read ${file} (${e.message}). Nothing was changed.`, 10000); return; }
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.agent-brain.bak');
      cfg.hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};
      strip(cfg.hooks);
      const ours = this.hooksConfig();
      for (const e of Object.keys(ours)) cfg.hooks[e] = (cfg.hooks[e] || []).concat(ours[e]);
      telemetry = this.settings.telemetry ? mergeTelemetryEnv(cfg, port) : 'off';
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    } catch (e) { new Notice(`Agent Brain: could not write ${file} (${e.message}).`, 10000); return; }
    // an older copy in this vault's project settings would make every event arrive twice: take ours out there
    let moved = 0;
    const base = this.app.vault.adapter && this.app.vault.adapter.basePath;
    for (const f of base ? [path.join(base, '.claude', 'settings.local.json'), path.join(base, '.claude', 'settings.json')] : []) {
      try {
        if (!fs.existsSync(f)) continue;
        const c = JSON.parse(fs.readFileSync(f, 'utf8') || '{}');
        const n = c.hooks ? strip(c.hooks) : 0;
        if (!n) continue;
        fs.copyFileSync(f, f + '.agent-brain.bak');
        if (c.hooks && !Object.keys(c.hooks).length) delete c.hooks;
        fs.writeFileSync(f, JSON.stringify(c, null, 2)); moved += n;
      } catch (e) { /* leave a file we can't parse alone */ }
    }
    const tmsg = telemetry === 'set' ? ' Telemetry (model calls, tokens, cost) now goes to the brain as well.' : telemetry === 'other' ? ' Telemetry already goes elsewhere, so it was left alone.' : '';
    new Notice(`Agent Brain: hooks for ${Object.keys(this.hooksConfig()).length} events installed in ${file}${moved ? ', and the older copy in this vault\'s .claude settings was removed' : ''}.${tmsg} Restart running Claude Code sessions to use them.`, 12000);
  }
  async copyHooks() {
    await navigator.clipboard.writeText(this.hooksJson());
    new Notice('Claude Code hook config copied. Paste it into ~/.claude/settings.json.');
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async activateMini() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_MINI)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_MINI, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async runDemo() {
    await this.activateView();
    const files = this.app.vault.getMarkdownFiles();
    if (!files.length) return;
    const pick = (re) => { const c = files.filter(f => re.test(f.path)); const src = c.length ? c : files; return src[Math.floor(Math.random() * src.length)]; };
    const base = this.app.vault.adapter.basePath;
    const abs = (f) => base.replace(/[\\/]+$/, '') + '/' + f.path;
    const stamp = Date.now();
    const T = (name, input, ag) => Object.assign({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }, ag || {});
    const P = (name, ag, extra) => Object.assign({ hook_event_name: 'PostToolUse', tool_name: name }, ag || {}, extra || {});
    const AS = (ag) => Object.assign({ hook_event_name: 'SubagentStart' }, ag);
    const AE = (ag) => Object.assign({ hook_event_name: 'SubagentStop' }, ag);
    // every call gets an id, as in a real session, so the inspector pairs each call with its result
    const run = (sid, cwd, steps) => {
      const open = new Map(); let n = 0;
      for (const [, ev] of [...steps].sort((x, y) => x[0] - y[0])) {
        if (!ev.tool_name || ev.tool_use_id) continue;
        const k = (ev.agent_id || '') + '|' + ev.tool_name, q = open.get(k) || open.set(k, []).get(k);
        if (ev.hook_event_name === 'PreToolUse') { ev.tool_use_id = `toolu_demo_${sid.slice(5, 6)}${++n}`; q.push(ev.tool_use_id); }
        else if (ev.hook_event_name === 'PermissionRequest') { if (q.length) ev.tool_use_id = q[q.length - 1]; }
        else if (q.length) ev.tool_use_id = q.shift();
      }
      for (const [t, ev] of steps) window.setTimeout(() => this.handleEvent(Object.assign({ session_id: sid, cwd, permission_mode: 'default' }, ev)), t);
    };

    // A: a local session in this vault, delegating a scan to an Explore subagent
    const sidA = 'demo-a-' + stamp, ex = { agent_id: 'demo-ex-' + stamp, agent_type: 'Explore' };
    const say = (t0, n) => Array.from({ length: n }, (_, i) => [t0 + i * 45, { hook_event_name: 'MessageDisplay', display_content: 'x'.repeat(40 + (i % 3) * 20), is_final_chunk: i === n - 1 }]);
    run(sidA, base, [
      [0, { hook_event_name: 'SessionStart' }],
      [300, { hook_event_name: 'InstructionsLoaded', file_path: base + '\\CLAUDE.md', load_reason: 'session_start' }],
      [900, { hook_event_name: 'UserPromptSubmit', prompt: 'Find this week\'s deadlines in my notes and update the project plan.' }],
      [2000, T('Read', { file_path: abs(pick(/index|home|readme/i)) })], [2500, P('Read')],
      [3200, T('Grep', { pattern: 'deadline', path: base })], [3700, P('Grep')],
      [4300, T('Read', { file_path: abs(pick(/notes?|journal|daily/i)) })], [4700, P('Read')],
      [5400, T('Agent', { subagent_type: 'Explore', description: 'Scan the vault for meeting notes', prompt: 'Look through the vault for meeting notes from the last two weeks. List every action item with its owner and due date, and say which note it came from.' })],
      [5600, AS(ex)],
      [6000, T('Read', { file_path: abs(pick(/meeting|people|team/i)) }, ex)], [6300, P('Read', ex)],
      [6800, T('Grep', { pattern: 'action items', path: base }, ex)], [7200, P('Grep', ex)],
      [7600, T('Read', { file_path: abs(pick(/meeting|people|team/i)) }, ex)], [8000, P('Read', ex)],
      [8600, Object.assign(AE(ex), { last_assistant_message: 'Found 3 meeting notes with 5 action items; 2 are due this week.' })], [8700, P('Agent', null, { tool_response: { content: [{ type: 'text', text: 'Found 3 meeting notes with 5 action items; 2 are due this week.' }] } })],
      [9200, T('WebSearch', { query: 'obsidian dataview task query' })], [9900, P('WebSearch')],
      [10800, T('Edit', { file_path: abs(pick(/projects?|plan|todo/i)) })], [11300, P('Edit')],
      [12000, T('Bash', { command: 'git status --short && npm test 2>&1 | tail -n 20', description: 'Run tests' })], [13000, P('Bash', null, { tool_response: { stdout: ' M projects/plan.md\n\n  42 passing (1s)\n', stderr: '', interrupted: false } })],
      ...say(13600, 26),
      [15000, { hook_event_name: 'Stop' }],
    ]);

    // B: a "remote" session (paths outside the vault) with a task list, blocked on an approval for a while
    const sidB = 'demo-b-' + stamp, cwdB = '/home/dev/api-server';
    run(sidB, cwdB, [
      [400, { hook_event_name: 'SessionStart' }],
      [1300, { hook_event_name: 'UserPromptSubmit', prompt: 'The API retries failed requests forever. Find out why and fix it.' }],
      [2200, T('TaskCreate', { subject: 'Reproduce the retry bug' })], [2300, P('TaskCreate', null, { tool_response: 'Task #1 created successfully' })],
      [2400, T('TaskCreate', { subject: 'Fix the retry policy' })], [2500, P('TaskCreate', null, { tool_response: 'Task #2 created successfully' })],
      [2600, T('TaskCreate', { subject: 'Run the test suite' })], [2700, P('TaskCreate', null, { tool_response: 'Task #3 created successfully' })],
      [2900, T('TaskUpdate', { taskId: '1', status: 'in_progress', activeForm: 'Reproducing the retry bug' })], [3000, P('TaskUpdate')],
      [3400, T('Bash', { command: 'journalctl -u api --since "1 hour ago" | grep -i retry', description: 'Check the agent logs' })], [3700, P('Bash', null, { tool_response: { stdout: 'api[812]: retry 1/∞ after 500 from /v1/jobs\napi[812]: retry 2/∞ after 500 from /v1/jobs\napi[812]: retry 3/∞ after 500 from /v1/jobs\n', stderr: '', interrupted: false } })],
      [3800, T('Read', { file_path: cwdB + '/src/agent/config.ts' })], [4200, P('Read')],
      [5000, T('Grep', { pattern: 'retryPolicy', path: cwdB + '/src' })], [5500, P('Grep')],
      [5800, T('TaskUpdate', { taskId: '1', status: 'completed' })], [5900, P('TaskUpdate')], [5950, { hook_event_name: 'TaskCompleted', task_name: 'Reproduce the retry bug' }],
      [6000, T('TaskUpdate', { taskId: '2', status: 'in_progress', activeForm: 'Fixing the retry policy' })], [6100, P('TaskUpdate')],
      [6600, T('Bash', { command: 'npm test', description: 'Run the test suite' })],
      [7000, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } }],
      [7200, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }],
      [13200, P('Bash')],
      [14200, T('Edit', { file_path: cwdB + '/src/agent/retry.ts' })], [14700, P('Edit')],
      [15400, T('Bash', { command: 'sudo systemctl restart api', description: 'Restart the agent service' })], [15900, P('Bash')],
      [16300, T('Bash', { command: 'curl -s http://127.0.0.1:8080/health', description: 'Check the health endpoint' })], [16600, P('Bash')],
      [15000, T('TaskUpdate', { taskId: '2', status: 'completed' })], [15100, P('TaskUpdate')],
      [15200, T('TaskUpdate', { taskId: '3', status: 'in_progress', activeForm: 'Running the test suite' })], [15300, P('TaskUpdate')],
      [16800, { hook_event_name: 'Stop' }],
    ]);

    // C: a "remote" session that launches a dynamic workflow: several agents fan out in the background
    const sidC = 'demo-c-' + stamp, cwdC = '/home/dev/docs-site';
    const wf = (i, type) => ({ agent_id: `demo-wf${i}-` + stamp, agent_type: type || 'general-purpose' });
    const areas = ['getting-started', 'install', 'configuration', 'api', 'faq'];
    const stepsC = [
      [700, { hook_event_name: 'SessionStart' }],
      [2300, { hook_event_name: 'UserPromptSubmit', prompt: 'Check every page of the docs against the style guide.' }],
      [4200, T('WebFetch', { url: 'https://example.com/style-guide' })], [5400, P('WebFetch')],
      [6400, T('Workflow', { name: 'docs-audit', description: 'Check every page against the style guide' })],
      [6900, P('Workflow')],
      [18500, { hook_event_name: 'Stop' }],
    ];
    areas.forEach((area, i) => {
      const ag = wf(i), t0 = 7300 + i * 450;
      stepsC.push([t0, AS(ag)]);
      stepsC.push([t0 + 900, T('Read', { file_path: `${cwdC}/pages/${area}.md` }, ag)], [t0 + 1300, P('Read', ag)]);
      stepsC.push([t0 + 2600 + i * 300, T('Grep', { pattern: 'TODO', path: `${cwdC}/pages` }, ag)], [t0 + 3100 + i * 300, P('Grep', ag)]);
      if (i % 2 === 0) stepsC.push([t0 + 4800, T('Write', { file_path: `${cwdC}/reports/${area}.md` }, ag)], [t0 + 5200, P('Write', ag)]);
      stepsC.push([t0 + 7000 + i * 1600, AE(ag)]);
    });
    const v = wf(9, 'verifier');
    stepsC.push([17500, AS(v)], [18200, T('Read', { file_path: `${cwdC}/reports/install.md` }, v)], [18600, P('Read', v)], [21500, AE(v)]);
    run(sidC, cwdC, stepsC);

    // telemetry: a model call every second or two while each session works
    const otel = (sid, out, cr, agent) => this.handleOtelLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: String(Date.now()) + '000000', attributes: [
      { key: 'event.name', value: { stringValue: 'claude_code.api_request' } }, { key: 'session.id', value: { stringValue: sid } }, { key: 'model', value: { stringValue: 'claude-opus-5-5' } },
      { key: 'input_tokens', value: { intValue: String(400 + Math.round(Math.random() * 2000)) } }, { key: 'output_tokens', value: { intValue: String(out) } },
      { key: 'cache_read_tokens', value: { intValue: String(cr) } }, { key: 'cache_creation_tokens', value: { intValue: '1200' } }, { key: 'cost_usd', value: { doubleValue: 0.004 + out / 40000 } },
      { key: 'duration_ms', value: { intValue: String(1500 + out * 3) } }].concat(agent ? [{ key: 'agent.name', value: { stringValue: agent } }] : []) }] }] }] }, 'local');
    for (let t = 1500; t < 15000; t += 1300 + Math.random() * 900) window.setTimeout(() => otel(sidA, Math.round(80 + Math.random() * 900), 20000 + Math.round(t * 3)), t);
    for (let t = 2000; t < 16500; t += 1600 + Math.random() * 900) window.setTimeout(() => otel(sidB, Math.round(60 + Math.random() * 600), 40000 + Math.round(t * 2)), t);
    for (let t = 3000; t < 21000; t += 900 + Math.random() * 700) window.setTimeout(() => otel(sidC, Math.round(100 + Math.random() * 1500), 60000 + Math.round(t * 4), t > 7000 && t < 19000 && Math.random() < 0.6 ? 'general-purpose' : ''), t);
    // a session that keeps retrying a failing command: the stuck alarm
    this.demoStuck = true;
    const sidD = 'demo-d-' + stamp, cwdD = '/home/dev/web-app';
    const fail = (t, i) => [[t, T('Bash', { command: 'npm run build', description: 'Build the site' })], [t + 600, { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm run build' }, error: 'exit 1' }]];
    run(sidD, cwdD, [[1000, { hook_event_name: 'SessionStart' }], [1800, { hook_event_name: 'UserPromptSubmit' }], ...fail(3000), ...fail(6000), ...fail(9000), ...fail(12000), [16000, { hook_event_name: 'Stop' }]]);
    window.setTimeout(() => { this.demoStuck = false; }, 20000);

    window.setTimeout(() => { for (const id of [sidA, sidB, sidC, sidD]) this.sessions.delete(id); this.updateStatusBar(); }, 60000);
  }
}

/* ================================================================ settings */

class BrainSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const save = () => this.plugin.saveAll();
    containerEl.empty();
    containerEl.createEl('p', { text: 'Listens for Claude Code hook events on 127.0.0.1 only. It never calls a model and uses no tokens. To place a note in a specific region, add "lobe: frontal" (frontal, motor, parietal, temporal, occipital, cerebellum, thalamus, stem) to its frontmatter.' });
    new Setting(containerEl).setName('Port').setDesc('Must match the port in the hook command. Changing it restarts the listener.')
      .addText(t => t.setValue(String(this.plugin.settings.port)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!n || n < 1024 || n > 65535) return;
        this.plugin.settings.port = n; await save(); this.plugin.startServer();
      }));
    new Setting(containerEl).setName('Look').setDesc('Anatomy: the realistic MRI glass brain. Atlas: a see-through brain where neurons (notes and files), synapses (links) and the signals stand out, tinted by region. Also in the layers menu, or press V.')
      .addDropdown(d => d.addOption('anatomy', 'Anatomy').addOption('atlas', 'Atlas').setValue(this.plugin.settings.look || 'anatomy')
        .onChange(async (v) => { this.plugin.settings.look = v; await save(); this.plugin.forEachView(w => { w.needsDraw = true; if (w.renderLookUi) w.renderLookUi(); }); }));
    new Setting(containerEl).setName('Glow').setDesc('How much activity and edges bloom. 0 turns the effect off (also lighter on the GPU).')
      .addSlider(sl => sl.setLimits(0, 1, 0.05).setValue(this.plugin.settings.bloom === false ? 0 : this.plugin.settings.glow).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.glow = v; this.plugin.settings.bloom = true; await save(); this.plugin.forEachView(w => { w.needsDraw = true; }); }));
    new Setting(containerEl).setName('Glass opacity').setDesc('Lower: inner neurons and fibers show through more. Higher: a more opaque, realistic surface.')
      .addSlider(s => s.setLimits(0.2, 1, 0.02).setValue(this.plugin.settings.glass).setDynamicTooltip().onChange(async (v) => { this.plugin.settings.glass = v; await save(); }));
    new Setting(containerEl).setName('Render quality').setDesc('Auto starts at 1.5x and steps down by itself if frames take too long. Low is lightest on laptops.')
      .addDropdown(d => d.addOption('auto', 'Auto').addOption('high', 'High (retina)').addOption('low', 'Low').setValue(this.plugin.settings.quality)
        .onChange(async (v) => { this.plugin.settings.quality = v; await save(); this.plugin.forEachView(view => { view.qLevel = 0; view.applyQuality(); }); }));
    new Setting(containerEl).setName('Frame rate').setDesc('Smooth renders every screen refresh while something moves. Battery renders every other refresh, at an even pace.')
      .addDropdown(d => d.addOption('60', 'Smooth').addOption('30', 'Battery').setValue(String(this.plugin.settings.fps))
        .onChange(async (v) => { this.plugin.settings.fps = Number(v); await save(); }));
    new Setting(containerEl).setName('Auto-rotate').setDesc('Slowly rotates the brain when you are not interacting with it.')
      .addToggle(t => t.setValue(!!this.plugin.settings.autoRotate).onChange(async (v) => { this.plugin.settings.autoRotate = v; await save(); }));
    new Setting(containerEl).setName('Region names on the brain').setDesc('Always show lobe names. When off, a name only appears while something is happening there.')
      .addToggle(t => t.setValue(!!this.plugin.settings.regionLabels).onChange(async (v) => { this.plugin.settings.regionLabels = v; await save(); }));
    new Setting(containerEl).setName('Follow activity').setDesc('The camera turns towards the busiest region, and hands control back to you for a few seconds after you drag.')
      .addToggle(t => t.setValue(!!this.plugin.settings.follow).onChange(async (v) => { this.plugin.settings.follow = v; await save(); }));
    new Setting(containerEl).setName('Activity trace').setDesc('Every action leaves a mark where it happened: the gyrus it lit up, the nucleus that took part and the fibre the signal used. Coloured by the kind of work, brighter the more it is used, fading by half after the time below. Saved across restarts.')
      .addToggle(t => t.setValue(this.plugin.settings.memoryTrace !== false).onChange(async (v) => { this.plugin.settings.memoryTrace = v; await save(); }))
      .addButton(b => b.setButtonText('Clear').onClick(() => { this.plugin.resetEngram(); this.plugin.resetMemory(); }));
    new Setting(containerEl).setName('Trace half-life').setDesc('How long a trace takes to fade to half.')
      .addDropdown(d => d.addOption('30', '30 minutes').addOption('90', '90 minutes').addOption('240', '4 hours').addOption('720', '12 hours').addOption('1440', '1 day')
        .setValue(String(this.plugin.settings.traceMinutes || 90))
        .onChange(async (v) => { this.plugin.engRebase(true); this.plugin.settings.traceMinutes = Number(v); this.plugin.engram.t0 = Date.now(); await save(); }));
    new Setting(containerEl).setName('Energy from telemetry').setDesc('Claude Code reports every model call with its tokens, time and cost. With this on, the hook installer also sends that telemetry here: each call shows as a slow warm response in prefrontal cortex, cached context lights the hippocampus, and sessions show their working memory and cost. Prompt and reply text are never included. Reinstall the hooks after changing this.')
      .addToggle(t => t.setValue(!!this.plugin.settings.telemetry).onChange(async (v) => { this.plugin.settings.telemetry = v; await save(); }));
    new Setting(containerEl).setName('Dream when idle').setDesc('After a few quiet minutes the brain replays the last hours of work in fast forward, with slow waves, the way the hippocampus replays the day in sleep. Any real event wakes it.')
      .addToggle(t => t.setValue(!!this.plugin.settings.dream).onChange(async (v) => { this.plugin.settings.dream = v; await save(); if (!v) this.plugin.forEachView(w => w.stopDream && w.stopDream()); }));
    new Setting(containerEl).setName('Body signals').setDesc('CPU, memory, network and disk of this computer and of servers on the tunnel. The brain stem beats faster with CPU load, network and disk traffic run along the lower pathways, and the ventricles light up when memory gets tight.')
      .addToggle(t => t.setValue(!!this.plugin.settings.vitals).onChange(async (v) => { this.plugin.settings.vitals = v; this.plugin.settings.showVitals = v; if (!v) this.plugin.vitals.clear(); await save(); }));

    new Setting(containerEl).setName('Learn connections').setDesc('Files Claude works with become neurons, and files it uses one after another get connected. Connections strengthen with reuse and fade over a few days when unused.')
      .addToggle(t => t.setValue(!!this.plugin.settings.learning).onChange(async (v) => { this.plugin.settings.learning = v; await save(); }))
      .addButton(b => b.setButtonText('Forget').onClick(() => this.plugin.resetLearned()));
    new Setting(containerEl).setName('Mini brain').setDesc('A small live view for the right sidebar, to keep an eye on things while you write.')
      .addButton(b => b.setButtonText('Open in sidebar').onClick(() => this.plugin.activateMini()));

    new Setting(containerEl).setName('Daily activity note').setHeading();
    new Setting(containerEl).setName('Write a daily note').setDesc('One note per day with time, tool calls, subagents, workflows, finished tasks and files per session. Refreshed every 10 minutes; anything under "## My notes" is kept.')
      .addToggle(t => t.setValue(!!this.plugin.settings.dailyNote).onChange(async (v) => { this.plugin.settings.dailyNote = v; await save(); }))
      .addButton(b => b.setButtonText('Open today').onClick(async () => { const p = await this.plugin.writeDailyNote(null, true); if (!p) new Notice('Agent Brain: no activity recorded today yet.'); }));
    new Setting(containerEl).setName('Folder').setDesc('Where the daily notes go.')
      .addText(t => t.setValue(this.plugin.settings.dailyFolder).onChange(async (v) => { this.plugin.settings.dailyFolder = v.trim() || 'Claude Activity'; await save(); }));

    new Setting(containerEl).setName('Alerts').setHeading();
    new Setting(containerEl).setName('Approval requests').setDesc('Alert when a session is blocked waiting for you to approve a tool.')
      .addToggle(t => t.setValue(!!this.plugin.settings.notifyApproval).onChange(async (v) => { this.plugin.settings.notifyApproval = v; await save(); }));
    new Setting(containerEl).setName('Waiting for your reply').setDesc('Alert when a long task (1 min or more) finishes, or a session has sat idle waiting for your reply.')
      .addToggle(t => t.setValue(!!this.plugin.settings.notifyReply).onChange(async (v) => { this.plugin.settings.notifyReply = v; await save(); }));
    new Setting(containerEl).setName('Sessions that may be stuck').setDesc('Alert when the same command keeps failing or is run again and again, a file is edited over and over, API errors pile up, a command runs for more than 20 minutes, or nothing moves for 10 minutes while a session is working.')
      .addToggle(t => t.setValue(!!this.plugin.settings.notifyStuck).onChange(async (v) => { this.plugin.settings.notifyStuck = v; await save(); }));
    new Setting(containerEl).setName('Desktop notifications').setDesc('When Obsidian is in the background, also show a system notification.')
      .addToggle(t => t.setValue(!!this.plugin.settings.desktopNotify).onChange(async (v) => { this.plugin.settings.desktopNotify = v; await save(); }));
    new Setting(containerEl).setName('Inspector').setHeading();
    new Setting(containerEl).setName('Full call details').setDesc('Freeze the brain (Space) and click a travelling signal, or click an event in a session: you see everything Claude Code sent about that call. Every parameter of the command, which agent ran it and which call started that agent, what Claude said just before, the plan step, your prompt, where it went, its output, and the raw hook events. Kept in memory only for recent calls, never written to disk, gone when Obsidian closes.')
      .addToggle(t => t.setValue(this.plugin.settings.callDetails !== false).onChange(async (v) => { this.plugin.settings.callDetails = v; if (!v) this.plugin.clearDetails(); await save(); }));
    new Setting(containerEl).setName('Other').setHeading();
    new Setting(containerEl).setName('Decorative ambient activity').setDesc('When on, random neurons flicker softly. This is not real data; when off, everything that lights up is a real Claude Code event.')
      .addToggle(t => t.setValue(!!this.plugin.settings.ambient).onChange(async (v) => { this.plugin.settings.ambient = v; await save(); }));
    new Setting(containerEl).setName('Claude Code hooks on this computer').setDesc('Writes the hooks for every event into ~/.claude/settings.json (your other hooks stay, a backup is made). Restart running Claude Code sessions afterwards.')
      .addButton(b => b.setButtonText('Install').setCta().onClick(() => this.plugin.installLocalHooks()))
      .addButton(b => b.setButtonText('Copy JSON').onClick(() => this.plugin.copyHooks()));
    new Setting(containerEl).setName('Show Claude writing its reply').setDesc('Adds the MessageDisplay hook: Broca\'s area lights up while the reply streams in. The text itself is only kept in memory for the inspector (see Full call details). Reinstall the hooks after changing this.')
      .addToggle(t => t.setValue(this.plugin.settings.speechHook !== false).onChange(async (v) => { this.plugin.settings.speechHook = v; await save(); }));
    new Setting(containerEl).setName('Servers').setDesc('On a server reached through the tunnel, run this once (it installs the hook, queue and link scripts):  curl -s http://127.0.0.1:' + this.plugin.settings.port + '/install.sh | sh');
    new Setting(containerEl).setName('Demo').setDesc('Try the animation without a real session.')
      .addButton(b => b.setButtonText('Play demo').onClick(() => this.plugin.runDemo()));
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'Brain surface: MNI ICBM152 2009 template (McConnell Brain Imaging Centre, Montreal Neurological Institute), via the niivue project.' });
  }
}

AgentBrainPlugin.fromThisMachine = fromThisMachine;   // for the tests
module.exports = AgentBrainPlugin;
