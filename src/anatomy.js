// Full anatomy layers: AAL gyri on the cortex, subcortical nuclei and ventricles,
// HCP-1065 fibre tracts, and MRI slices through the MNI152 template.
import * as THREE from 'three';

/* ---------------- AAL atlas (116 regions) ---------------- */

const AAL_RAW = ['Precentral', 'Frontal_Sup', 'Frontal_Sup_Orb', 'Frontal_Mid', 'Frontal_Mid_Orb', 'Frontal_Inf_Oper', 'Frontal_Inf_Tri', 'Frontal_Inf_Orb',
  'Rolandic_Oper', 'Supp_Motor_Area', 'Olfactory', 'Frontal_Sup_Medial', 'Frontal_Med_Orb', 'Rectus', 'Insula', 'Cingulum_Ant', 'Cingulum_Mid', 'Cingulum_Post',
  'Hippocampus', 'ParaHippocampal', 'Amygdala', 'Calcarine', 'Cuneus', 'Lingual', 'Occipital_Sup', 'Occipital_Mid', 'Occipital_Inf', 'Fusiform', 'Postcentral',
  'Parietal_Sup', 'Parietal_Inf', 'SupraMarginal', 'Angular', 'Precuneus', 'Paracentral_Lobule', 'Caudate', 'Putamen', 'Pallidum', 'Thalamus', 'Heschl',
  'Temporal_Sup', 'Temporal_Pole_Sup', 'Temporal_Mid', 'Temporal_Pole_Mid', 'Temporal_Inf', 'Cerebelum_Crus1', 'Cerebelum_Crus2', 'Cerebelum_3', 'Cerebelum_4_5',
  'Cerebelum_6', 'Cerebelum_7b', 'Cerebelum_8', 'Cerebelum_9', 'Cerebelum_10'];
const VERMIS = ['Vermis_1_2', 'Vermis_3', 'Vermis_4_5', 'Vermis_6', 'Vermis_7', 'Vermis_8', 'Vermis_9', 'Vermis_10'];
const PRETTY = {
  Precentral: 'Precentral gyrus (primary motor)', Frontal_Sup: 'Superior frontal gyrus', Frontal_Sup_Orb: 'Superior frontal gyrus, orbital part',
  Frontal_Mid: 'Middle frontal gyrus', Frontal_Mid_Orb: 'Middle frontal gyrus, orbital part', Frontal_Inf_Oper: 'Inferior frontal gyrus, opercular part',
  Frontal_Inf_Tri: 'Inferior frontal gyrus, triangular part', Frontal_Inf_Orb: 'Inferior frontal gyrus, orbital part', Rolandic_Oper: 'Rolandic operculum',
  Supp_Motor_Area: 'Supplementary motor area', Olfactory: 'Olfactory cortex', Frontal_Sup_Medial: 'Medial superior frontal gyrus',
  Frontal_Med_Orb: 'Medial orbitofrontal cortex', Rectus: 'Gyrus rectus', Insula: 'Insula', Cingulum_Ant: 'Anterior cingulate cortex',
  Cingulum_Mid: 'Middle cingulate cortex', Cingulum_Post: 'Posterior cingulate cortex', Hippocampus: 'Hippocampus', ParaHippocampal: 'Parahippocampal gyrus',
  Amygdala: 'Amygdala', Calcarine: 'Calcarine cortex (primary visual)', Cuneus: 'Cuneus', Lingual: 'Lingual gyrus', Occipital_Sup: 'Superior occipital gyrus',
  Occipital_Mid: 'Middle occipital gyrus', Occipital_Inf: 'Inferior occipital gyrus', Fusiform: 'Fusiform gyrus', Postcentral: 'Postcentral gyrus (somatosensory)',
  Parietal_Sup: 'Superior parietal lobule', Parietal_Inf: 'Inferior parietal lobule', SupraMarginal: 'Supramarginal gyrus', Angular: 'Angular gyrus',
  Precuneus: 'Precuneus', Paracentral_Lobule: 'Paracentral lobule', Caudate: 'Caudate nucleus', Putamen: 'Putamen', Pallidum: 'Globus pallidus',
  Thalamus: 'Thalamus', Heschl: 'Heschl\'s gyrus (primary auditory)', Temporal_Sup: 'Superior temporal gyrus', Temporal_Pole_Sup: 'Temporal pole, superior',
  Temporal_Mid: 'Middle temporal gyrus', Temporal_Pole_Mid: 'Temporal pole, middle', Temporal_Inf: 'Inferior temporal gyrus',
};
export const AAL = [null];
for (const r of AAL_RAW) for (const side of ['L', 'R']) {
  let name = PRETTY[r];
  if (!name && r.startsWith('Cerebelum_')) name = 'Cerebellum, ' + r.slice(10).replace('Crus', 'crus ').replace('_', '–') + (/^\d/.test(r.slice(10)) ? '' : '');
  if (r.startsWith('Cerebelum_') && /^\d/.test(r.slice(10))) name = 'Cerebellum, lobule ' + r.slice(10).replace('_', '–');
  AAL.push({ key: r + '_' + side, name, side: side === 'L' ? 'left' : 'right' });
}
for (const v of VERMIS) AAL.push({ key: v, name: 'Vermis ' + v.slice(7).replace('_', '–'), side: 'midline' });
const IDX = Object.fromEntries(AAL.map((a, i) => [a ? a.key : '', i]));
const both = (...names) => names.flatMap(n => [IDX[n + '_L'], IDX[n + '_R']]).filter(Boolean);
const left = (...names) => names.map(n => IDX[n + '_L']).filter(Boolean);

// which gyri light up for each kind of work
export const GYRI = {
  read: both('Temporal_Mid', 'Temporal_Inf', 'Fusiform', 'Temporal_Sup'),
  write: both('Precentral', 'Supp_Motor_Area', 'Paracentral_Lobule'),
  exec: both('Frontal_Mid', 'Frontal_Sup', 'Frontal_Inf_Oper'),
  plan: both('Frontal_Sup_Medial', 'Frontal_Inf_Tri', 'Frontal_Mid'),
  web: both('Calcarine', 'Cuneus', 'Occipital_Sup', 'Occipital_Mid', 'Lingual'),
  agent: both('Parietal_Sup', 'Parietal_Inf', 'SupraMarginal', 'Angular', 'Precuneus'),
  ops: both('Cerebelum_Crus1', 'Cerebelum_Crus2', 'Cerebelum_6', 'Cerebelum_4_5'),
  mcp: both('Cerebelum_Crus1', 'Cerebelum_8', 'Cerebelum_7b'),
  other: both('Parietal_Inf', 'SupraMarginal'),
  prompt: both('Heschl', 'Temporal_Sup'),
  // beyond tool calls: where the other things Claude Code does show up
  speak: left('Frontal_Inf_Oper', 'Frontal_Inf_Tri'),            // Broca's area: Claude writing its reply
  memory: both('Hippocampus', 'ParaHippocampal'),                // recall and consolidation
  self: both('Precuneus', 'Cingulum_Post'),                      // instructions and settings: the model of itself
  alarm: both('Cingulum_Ant', 'Frontal_Med_Orb'),                // conflict: permissions, denials, errors
  doubt: both('Insula', 'Cingulum_Ant'),                         // prediction error: what the agent believed and what was there differ
  reward: both('Frontal_Med_Orb', 'Rectus'),                     // a task done
  place: both('ParaHippocampal', 'Precuneus'),                   // moving to another folder or worktree
  sense: both('Postcentral'),                                    // something changed on disk
  social: both('Angular', 'Temporal_Pole_Sup'),                  // asking you something
  think: both('Frontal_Sup', 'Frontal_Mid', 'Frontal_Sup_Medial', 'Frontal_Inf_Tri', 'Cingulum_Ant', 'Frontal_Mid_Orb'),   // deliberation: prefrontal cortex
};

// lobe of each AAL region, as an index into LOBE_ORDER (frontal, motor, parietal, temporal, occipital, cerebellum, thalamus, stem)
const LOBE_OF = {
  frontal: ['Frontal_Sup', 'Frontal_Sup_Orb', 'Frontal_Mid', 'Frontal_Mid_Orb', 'Frontal_Inf_Oper', 'Frontal_Inf_Tri', 'Frontal_Inf_Orb', 'Olfactory', 'Frontal_Sup_Medial', 'Frontal_Med_Orb', 'Rectus', 'Cingulum_Ant'],
  motor: ['Precentral', 'Supp_Motor_Area', 'Paracentral_Lobule', 'Rolandic_Oper'],
  parietal: ['Postcentral', 'Parietal_Sup', 'Parietal_Inf', 'SupraMarginal', 'Angular', 'Precuneus', 'Cingulum_Mid', 'Cingulum_Post'],
  temporal: ['Hippocampus', 'ParaHippocampal', 'Amygdala', 'Fusiform', 'Heschl', 'Temporal_Sup', 'Temporal_Pole_Sup', 'Temporal_Mid', 'Temporal_Pole_Mid', 'Temporal_Inf', 'Insula'],
  occipital: ['Calcarine', 'Cuneus', 'Lingual', 'Occipital_Sup', 'Occipital_Mid', 'Occipital_Inf'],
  thalamus: ['Caudate', 'Putamen', 'Pallidum', 'Thalamus'],
};
const ORDER = ['frontal', 'motor', 'parietal', 'temporal', 'occipital', 'cerebellum', 'thalamus', 'stem'];
export const AAL_LOBE = AAL.map((a) => {
  if (!a) return -1;
  const base = a.key.replace(/_[LR]$/, '');
  if (base.startsWith('Cerebelum_') || base.startsWith('Vermis_')) return 5;
  for (const k in LOBE_OF) if (LOBE_OF[k].includes(base)) return ORDER.indexOf(k);
  return -1;
});

export function aalName(i) { const a = AAL[i]; return a ? (a.side === 'midline' ? a.name : `${a.name}, ${a.side}`) : ''; }

/* ---------------- binary readers ---------------- */

const td = new TextDecoder();
export function parseAal(buf) {
  const dv = new DataView(buf);
  if (td.decode(new Uint8Array(buf, 0, 4)) !== 'CBA1') throw new Error('bad aal.bin');
  const n = dv.getUint32(4, true);
  return new Uint8Array(buf.slice(8, 8 + n));
}
export function parseInner(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (td.decode(u8.subarray(0, 4)) !== 'CBI1') throw new Error('bad inner.bin');
  let o = 5; const parts = [];
  const str = () => { const n = u8[o]; o += 1; const s = td.decode(u8.subarray(o, o + n)); o += n; return s; };
  for (let k = 0; k < u8[4]; k++) {
    const id = u8[o]; o += 1;
    const name = str(), side = str(), kind = str();
    const nv = dv.getUint32(o, true), nf = dv.getUint32(o + 4, true); o += 8;
    const q = new Int16Array(buf.slice(o, o + nv * 6)); o += nv * 6;
    const idx = new Uint32Array(buf.slice(o, o + nf * 12)); o += nf * 12;
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) pos[i] = q[i] / 100;
    parts.push({ id, name, side, kind, pos, idx });
  }
  return parts;
}
export function parseT1(buf) {
  const dv = new DataView(buf);
  if (td.decode(new Uint8Array(buf, 0, 4)) !== 'CBV1') throw new Error('bad t1.bin');
  const nx = dv.getUint16(4, true), ny = dv.getUint16(6, true), nz = dv.getUint16(8, true);
  const lo = [dv.getFloat32(10, true), dv.getFloat32(14, true), dv.getFloat32(18, true)], sp = dv.getFloat32(22, true);
  return { dims: [nx, ny, nz], lo, sp, data: new Uint8Array(buf.slice(26, 26 + nx * ny * nz)) };
}
export function parseTracts(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  if (td.decode(u8.subarray(0, 4)) !== 'CBT1') throw new Error('bad tracts.bin');
  let o = 6; const lines = [];
  for (let b = 0; b < dv.getUint16(4, true); b++) {
    const kl = u8[o]; o += 1; const bundle = td.decode(u8.subarray(o, o + kl)); o += kl;
    const ns = dv.getUint16(o, true); o += 2;
    for (let s = 0; s < ns; s++) {
      const m = dv.getUint16(o, true), ea = u8[o + 2], eb = u8[o + 3]; o += 4;
      const q = new Int16Array(buf.slice(o, o + m * 6)); o += m * 6;
      const pts = new Float32Array(m * 3);
      for (let i = 0; i < m * 3; i++) pts[i] = q[i] / 10;
      lines.push({ bundle, ea, eb, pts });
    }
  }
  return lines;
}

const BUNDLES = {
  AC: 'Anterior commissure', AF: 'Arcuate fasciculus', AR: 'Acoustic radiation', CBT: 'Corticobulbar tract', CB: 'Cerebellar tract', CC: 'Corpus callosum',
  CPT_F: 'Frontal corticopontine tract', CPT_O: 'Occipital corticopontine tract', CPT_P: 'Parietal corticopontine tract', CST: 'Corticospinal tract',
  CS_A: 'Anterior corticostriatal tract', CS_P: 'Posterior corticostriatal tract', CS_S: 'Superior corticostriatal tract', C_FPH: 'Frontal parahippocampal cingulum',
  C_FP: 'Frontoparietal cingulum', C_PHP: 'Parahippocampal parietal cingulum', C_PH: 'Parahippocampal cingulum', C_PO: 'Parolfactory cingulum',
  DRTT: 'Dentatorubrothalamic tract', EMC: 'Extreme capsule', FAT: 'Frontal aslant tract', F: 'Fornix', ICP: 'Inferior cerebellar peduncle',
  IFOF: 'Inferior fronto-occipital fasciculus', ILF: 'Inferior longitudinal fasciculus', MCP: 'Middle cerebellar peduncle', ML: 'Medial lemniscus',
  MdLF: 'Middle longitudinal fasciculus', OR: 'Optic radiation', PAT: 'Parietal aslant tract', RST: 'Reticulospinal tract', SCP: 'Superior cerebellar peduncle',
  SLF1: 'Superior longitudinal fasciculus I', SLF2: 'Superior longitudinal fasciculus II', SLF3: 'Superior longitudinal fasciculus III',
  TR_A: 'Anterior thalamic radiation', TR_P: 'Posterior thalamic radiation', TR_S: 'Superior thalamic radiation', UF: 'Uncinate fasciculus', V: 'Vermis tract', VOF: 'Vertical occipital fasciculus',
};
export function bundleName(key) {
  const m = key.match(/^(.*?)(?:_([LR]))?$/);
  const base = BUNDLES[m[1]] || m[1];
  return m[2] ? `${base}, ${m[2] === 'L' ? 'left' : 'right'}` : base;
}

/* ---------------- materials ---------------- */

const KIND = {
  relay: { color: 0xa9b8e8, alpha: 0.9 },      // thalamus
  basal: { color: 0x8fc3d6, alpha: 0.85 },     // caudate, putamen, pallidum
  memory: { color: 0xb9a6ff, alpha: 0.9 },     // hippocampus
  salience: { color: 0xff9db0, alpha: 0.9 },   // amygdala
  csf: { color: 0x5aa8ff, alpha: 0.28 },       // ventricles
};

const INNER_VS = `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const INNER_FS = `
#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 uColor; uniform float uAlpha; uniform float uAct; uniform vec3 uActColor; uniform vec3 uLight; uniform float uTrace; uniform vec3 uTraceC;
varying vec3 vN; varying vec3 vV;
void main() {
  #include <clipping_planes_fragment>
  vec3 N = normalize(vN); vec3 V = normalize(vV);
  if (!gl_FrontFacing) N = -N;
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 2.0);
  float diff = max(dot(N, normalize(uLight)), 0.0);
  vec3 col = uColor * (0.22 + 0.55 * diff) + uColor * fres * 0.5;
  col += uTraceC * uTrace * (0.05 + 0.14 * fres);      // lasting trace of the work this nucleus took part in
  col += uActColor * uAct * (0.32 + 0.45 * fres);     // activity tints the nucleus, kept under the bloom threshold
  gl_FragColor = vec4(col, clamp(uAlpha * (0.38 + 0.5 * fres) + uAct * 0.2 + uTrace * 0.04, 0.0, 1.0));
}`;

export function makeInner(parts, light) {
  const out = [];
  for (const p of parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
    g.setIndex(new THREE.BufferAttribute(p.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const k = KIND[p.kind] || KIND.basal;
    const mat = new THREE.ShaderMaterial({
      vertexShader: INNER_VS, fragmentShader: INNER_FS, clipping: true,
      uniforms: { uColor: { value: new THREE.Color(k.color) }, uAlpha: { value: k.alpha }, uAct: { value: 0 }, uActColor: { value: new THREE.Color(0xffffff) }, uLight: { value: light }, uTrace: { value: 0 }, uTraceC: { value: new THREE.Color(0xffffff) } },
      // drawn after the glass cortex and without depth test, so they read as objects inside it
      transparent: true, depthWrite: false, depthTest: false, side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = p.kind === 'csf' ? 1 : 2;
    const c = g.boundingSphere.center;
    out.push({ mesh, mat, alpha0: k.alpha, name: p.name, side: p.side, kind: p.kind, center: { x: c.x, y: c.y, z: c.z }, act: 0, actColor: new THREE.Color(0xffffff), pos: p.pos, eng: 0, engC: new THREE.Color(0, 0, 0) });
  }
  return out;
}

// direction-encoded colour, as in diffusion MRI: red left–right, green front–back, blue up–down.
// Each fibre also carries how much it has been used: pathways that keep carrying signals stand out, then fade back.
const TRACT_VS = `
#include <common>
#include <clipping_planes_pars_vertex>
attribute vec3 aCol; attribute float aUse;
uniform float uEngK; uniform vec4 uSlab; uniform float uSlabOn;
varying vec3 vC; varying float vA;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float use = 1.0 - exp(-aUse * uEngK * 0.12);
  float a = 1.0 + 2.4 * use;
  // with an MRI slice open, only fibres running through the slice show, as on a diffusion map
  if (uSlabOn > 0.5) { float d = dot(uSlab.xyz, position) + uSlab.w; a = (5.0 + 6.0 * use) * exp(-d * d / 7.0); }
  vC = aCol * (1.0 + 0.3 * use); vA = a;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const TRACT_FS = `
#include <common>
#include <clipping_planes_pars_fragment>
uniform float uOpacity; varying vec3 vC; varying float vA;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(vC, clamp(uOpacity * vA, 0.0, 1.0));
}`;

export function makeTracts(lines) {
  let n = 0;
  for (const l of lines) n += l.pts.length / 3 - 1;
  const pos = new Float32Array(n * 6), col = new Float32Array(n * 6), use = new Float32Array(n * 2);
  const ranges = new Int32Array(lines.length * 2);
  let o = 0;
  lines.forEach((l, li) => {
    const p = l.pts;
    ranges[li * 2] = o / 3;
    for (let i = 0; i < p.length / 3 - 1; i++) {
      const dx = p[i * 3 + 3] - p[i * 3], dy = p[i * 3 + 4] - p[i * 3 + 1], dz = p[i * 3 + 5] - p[i * 3 + 2];
      const L = Math.hypot(dx, dy, dz) || 1;
      const r = Math.abs(dx) / L, gg = Math.abs(dz) / L, b = Math.abs(dy) / L;   // three: x=LR, z=AP, y=SI
      for (let j = 0; j < 2; j++) {
        pos[o] = p[(i + j) * 3]; pos[o + 1] = p[(i + j) * 3 + 1]; pos[o + 2] = p[(i + j) * 3 + 2];
        col[o] = 0.08 + 0.92 * r * r; col[o + 1] = 0.08 + 0.92 * gg * gg; col[o + 2] = 0.12 + 0.88 * b * b;
        o += 3;
      }
    }
    ranges[li * 2 + 1] = o / 3 - ranges[li * 2];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  const useAttr = new THREE.BufferAttribute(use, 1);
  useAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aUse', useAttr);
  const mat = new THREE.ShaderMaterial({
    vertexShader: TRACT_VS, fragmentShader: TRACT_FS, clipping: true,
    uniforms: { uOpacity: { value: 0.045 }, uEngK: { value: 1 }, uSlab: { value: new THREE.Vector4(1, 0, 0, 0) }, uSlabOn: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const obj = new THREE.LineSegments(g, mat);
  obj.renderOrder = 1; obj.frustumCulled = false;
  return { obj, mat, ranges, use, useAttr };
}

/* ---------------- MRI slice ---------------- */

const SLICE_VS = `
varying vec3 vP;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
// A cross-section in the brain's own light: tissue in deep blue, white matter pale, gyral outlines glowing like the
// glass rim, and live activity laid over it the way fMRI is shown on anatomy.
const SLICE_FS = `
precision highp sampler3D;
uniform sampler3D uVol; uniform vec3 uLo; uniform vec3 uSize; uniform float uOpacity;
uniform vec4 uPulse[MAXP]; uniform vec4 uPulseC[MAXP]; uniform int uNP;
uniform vec4 uInnerP[16]; uniform vec4 uInnerC[16]; uniform int uNI;
varying vec3 vP;
float tex(vec3 t) { return texture(uVol, t).r; }
void main() {
  vec3 m = vec3(vP.x, -(vP.z + 15.0), vP.y + 10.0);         // scene -> MNI mm
  vec3 t = (m - uLo) / uSize;
  if (any(lessThan(t, vec3(0.0))) || any(greaterThan(t, vec3(1.0)))) discard;
  float v = tex(t);
  if (v < 0.04) discard;
  // edges between tissue types (gyri, sulci, ventricles)
  vec3 e = 1.0 / uSize;
  float gx = tex(t + vec3(e.x, 0.0, 0.0)) - tex(t - vec3(e.x, 0.0, 0.0));
  float gy = tex(t + vec3(0.0, e.y, 0.0)) - tex(t - vec3(0.0, e.y, 0.0));
  float gz = tex(t + vec3(0.0, 0.0, e.z)) - tex(t - vec3(0.0, 0.0, e.z));
  float edge = smoothstep(0.08, 0.3, length(vec3(gx, gy, gz)));
  float wm = smoothstep(0.55, 0.9, v), gm = smoothstep(0.16, 0.5, v);
  // linear colours: after the sRGB output these read as a dark slate T1 image, not a bright plate
  vec3 c = mix(vec3(0.0, 0.002, 0.006), vec3(0.024, 0.034, 0.066), gm);     // CSF -> grey matter
  c = mix(c, vec3(0.088, 0.108, 0.152), wm);                                 // -> white matter
  c += vec3(0.03, 0.07, 0.2) * edge;                                         // thin tissue borders
  // live activity
  vec3 act = vec3(0.0);
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNP) break;
    vec3 d = vP - uPulse[i].xyz; float s = uPulse[i].w * 1.3;
    act += uPulseC[i].rgb * uPulseC[i].a * exp(-dot(d, d) / (s * s));
  }
  for (int i = 0; i < 16; i++) {
    if (i >= uNI) break;
    vec3 d = vP - uInnerP[i].xyz; float s = uInnerP[i].w;
    act += uInnerC[i].rgb * uInnerC[i].a * exp(-dot(d, d) / (s * s));
  }
  vec3 A = vec3(1.0) - exp(-act * 1.1);
  c += A * (0.22 + 0.55 * gm);                                              // like fMRI: activity shows on grey matter
  float alpha = uOpacity * (0.72 + 0.28 * gm + 0.2 * edge);
  gl_FragColor = vec4(c, clamp(alpha + max(A.r, max(A.g, A.b)) * 0.2, 0.0, 1.0));
}`;

export function makeSlice(vol, shared, maxp) {
  const [nx, ny, nz] = vol.dims;
  const tex = new THREE.Data3DTexture(vol.data, nx, ny, nz);
  tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SLICE_VS,
    fragmentShader: SLICE_FS.replace(/MAXP/g, String(maxp)),
    uniforms: {
      uVol: { value: tex }, uLo: { value: new THREE.Vector3(...vol.lo) }, uSize: { value: new THREE.Vector3(nx * vol.sp, ny * vol.sp, nz * vol.sp) }, uOpacity: { value: 0.92 },
      // the cortex's activity pulses, shared by reference so the slice lights up with them
      uPulse: shared.uPulse, uPulseC: shared.uPulseC, uNP: shared.uNP,
      uInnerP: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uInnerC: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uNI: { value: 0 },
    },
    transparent: true, side: THREE.DoubleSide, depthWrite: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -3;
  // extent of the volume in scene coordinates
  const lo = vol.lo, hi = [lo[0] + nx * vol.sp, lo[1] + ny * vol.sp, lo[2] + nz * vol.sp];
  const box = { x: [lo[0], hi[0]], y: [lo[2] - 10, hi[2] - 10], z: [-hi[1] - 15, -lo[1] - 15] };
  const set = (axis, t) => {
    const a = box[axis], v = a[0] + (a[1] - a[0]) * t;
    mesh.rotation.set(0, 0, 0); mesh.position.set(0, -6, -2);
    if (axis === 'x') { mesh.rotation.y = Math.PI / 2; mesh.scale.set(box.z[1] - box.z[0], box.y[1] - box.y[0], 1); mesh.position.set(v, (box.y[0] + box.y[1]) / 2, (box.z[0] + box.z[1]) / 2); }
    if (axis === 'y') { mesh.rotation.x = -Math.PI / 2; mesh.scale.set(box.x[1] - box.x[0], box.z[1] - box.z[0], 1); mesh.position.set((box.x[0] + box.x[1]) / 2, v, (box.z[0] + box.z[1]) / 2); }
    if (axis === 'z') { mesh.scale.set(box.x[1] - box.x[0], box.y[1] - box.y[0], 1); mesh.position.set((box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2, v); }
    mesh.updateMatrixWorld();
    return v;
  };
  return { mesh, mat, set, box };
}
