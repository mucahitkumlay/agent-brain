// Where a note lives in the brain, and why. Pure functions, no state: main.js passes what Obsidian's metadata cache
// already knows about a note (its path, frontmatter and tags) and never the note's text.

export const NOTE_LOBES = ['frontal', 'motor', 'parietal', 'temporal', 'occipital', 'cerebellum', 'thalamus'];

// what kind of notes each region holds (the notes view says this next to the region's name)
export const NOTE_KINDS = {
  frontal: 'projects, decisions, plans',
  motor: 'drafts, templates, writing',
  parietal: 'tools, concepts, how-tos',
  temporal: 'people, lessons, memory',
  occipital: 'sources, references, docs',
  cerebellum: 'daily notes, journals, logs',
  thalamus: 'indexes, hubs, home',
};

// folder and file names (the order matters: the first rule that matches wins)
export const FOLDER_RULES = [
  [/(^|\/)(hubs?|index|moc|home)(\/|$)/i, 'thalamus'],
  [/(^|\/)(daily|journal|logs?|incidents?|handoffs?)(\/|$)/i, 'cerebellum'],
  [/(^|\/)(lessons?|memory|memories|owner|people|persons?|learn\w*|notes?)(\/|$)/i, 'temporal'],
  [/(^|\/)(docs?|references?|sources?|repos?|archive|readme)(\/|$)/i, 'occipital'],
  [/(^|\/)(projects?|decisions?|plans?|tasks?|todo|roadmap)(\/|$)/i, 'frontal'],
  [/(^|\/)(drafts?|writing|edits?|templates?)(\/|$)/i, 'motor'],
  [/(^|\/)(tools?|plugins?|kernel|install|security|tests?|concepts?|agents?)(\/|$)/i, 'parietal'],
];

// the words a note's type, kind or category (or a tag) commonly uses
const WORDS = {
  frontal: ['project', 'projects', 'decision', 'decisions', 'plan', 'plans', 'task', 'tasks', 'todo', 'goal', 'goals', 'roadmap', 'okr'],
  motor: ['draft', 'drafts', 'template', 'templates', 'writing', 'post', 'posts', 'essay', 'outline'],
  parietal: ['concept', 'concepts', 'tool', 'tools', 'howto', 'how-to', 'guide', 'guides', 'topic', 'topics', 'idea', 'ideas', 'snippet', 'snippets'],
  temporal: ['person', 'people', 'contact', 'contacts', 'org', 'organization', 'organisation', 'company', 'meeting', 'meetings', 'lesson', 'lessons', 'memory', 'memories'],
  occipital: ['source', 'sources', 'reference', 'references', 'doc', 'docs', 'article', 'articles', 'paper', 'papers', 'book', 'books', 'repo', 'repos', 'clipping', 'clippings', 'web', 'literature'],
  cerebellum: ['daily', 'journal', 'log', 'logs', 'incident', 'incidents', 'diary', 'weekly', 'monthly', 'periodic'],
  thalamus: ['index', 'moc', 'hub', 'hubs', 'home', 'map', 'dashboard'],
};
const WORD_LOBE = new Map();
for (const [lobe, list] of Object.entries(WORDS)) for (const w of list) WORD_LOBE.set(w, lobe);

export const TYPE_FIELDS = ['type', 'kind', 'category'];
const DATE_NAME = /^\d{4}-\d{2}-\d{2}([ _-].*)?$/;

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/^#/, '');
// a region by its name, or by a word that means one ("project" → frontal)
export function lobeOf(word) { const w = norm(word); return NOTE_LOBES.includes(w) ? w : WORD_LOBE.get(w) || null; }
const values = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(norm).filter(Boolean).slice(0, 20);

// The user's own mappings, one per line: "type:wiki=occipital", "tag:client=temporal", "folder:Wiki=occipital".
// Anything after = may be a region or a word that means one. Lines that are not understood are returned, not guessed.
export function parseMappings(text) {
  const rules = [], bad = [];
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 400)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = line.match(/^([^:=]+):([^=]+)=(.+)$/);
    const lobe = m && lobeOf(m[3]);
    if (!m || !lobe) { bad.push(line.slice(0, 80)); continue; }
    const key = norm(m[1]), value = m[2].trim();
    if (!value) { bad.push(line.slice(0, 80)); continue; }
    rules.push({ key, value: key === 'folder' ? value.replace(/^\/+|\/+$/g, '').toLowerCase() : norm(value), lobe, line });
  }
  return { rules, bad };
}

// info: { path, basename, frontmatter, tags }. Returns { lobe, why } (lobe is null when nothing says where it goes).
export function classifyNote(info, rules) {
  const fm = info && info.frontmatter && typeof info.frontmatter === 'object' ? info.frontmatter : null;
  const tags = values(info && info.tags);
  const path = String((info && info.path) || '');
  const folders = path.split('/').slice(0, -1);
  // 1. the note says where it goes
  const want = fm && (fm.lobe != null ? fm.lobe : fm['brain-lobe']);
  if (want != null && NOTE_LOBES.includes(norm(want))) return { lobe: norm(want), why: 'lobe: ' + norm(want) };
  // 2. your own mappings, in the order you wrote them
  for (const r of rules || []) {
    if (r.key === 'tag' ? tags.includes(r.value)
      : r.key === 'folder' ? folders.some((_, i) => folders.slice(0, i + 1).join('/').toLowerCase() === r.value || folders[i].toLowerCase() === r.value)
      : fm && values(fm[r.key]).includes(r.value)) return { lobe: r.lobe, why: 'your mapping ' + r.line };
  }
  // 3. the note's type, kind or category
  if (fm) for (const f of TYPE_FIELDS) for (const v of values(fm[f])) { const l = WORD_LOBE.get(v); if (l) return { lobe: l, why: `${f}: ${v}` }; }
  // 4. its tags (the first part of a nested tag counts too: #project/website)
  for (const t of tags) { const l = WORD_LOBE.get(t) || WORD_LOBE.get(t.split('/')[0]); if (l) return { lobe: l, why: '#' + t }; }
  // 5. its folders, top down
  for (const seg of folders) for (const [re, lobe] of FOLDER_RULES) if (re.test('/' + seg + '/')) return { lobe, why: 'folder ' + seg };
  // 6. its name
  const base = String((info && info.basename) || '');
  if (DATE_NAME.test(base)) return { lobe: 'cerebellum', why: 'a dated name' };
  for (const [re, lobe] of FOLDER_RULES) if (re.test('/' + base + '/')) return { lobe, why: 'its name' };
  return { lobe: null, why: '' };
}

// What the placement looks like over the whole vault: how many notes landed where and for what reason, and the
// type/kind/category values that nothing maps yet (with how many notes carry them).
export function placementReport(items) {
  const lobes = {}, reasons = {}, unmapped = new Map();
  let unplaced = 0;
  for (const it of items || []) {
    const r = it.result || {};
    if (!r.lobe) unplaced++;
    else lobes[r.lobe] = (lobes[r.lobe] || 0) + 1;
    const kind = !r.why ? 'nothing (placed with its folder)' : r.why.startsWith('your mapping') ? 'your mappings' : r.why.startsWith('lobe:') ? 'lobe: in frontmatter'
      : /^(type|kind|category):/.test(r.why) ? 'type, kind or category' : r.why.startsWith('#') ? 'tags' : r.why.startsWith('folder') ? 'folder names' : 'file names';
    reasons[kind] = (reasons[kind] || 0) + 1;
    const fm = it.info && it.info.frontmatter;
    if (fm && (!r.why || !/^(lobe:|your mapping|type:|kind:|category:)/.test(r.why))) {
      for (const f of TYPE_FIELDS) for (const v of values(fm[f])) if (!WORD_LOBE.has(v)) {
        const k = f + ':' + v; unmapped.set(k, (unmapped.get(k) || 0) + 1);
      }
    }
  }
  return { lobes, reasons, unplaced, unmapped: [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30) };
}
