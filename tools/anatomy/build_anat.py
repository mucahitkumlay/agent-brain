#!/usr/bin/env python3
"""Builds the anatomy files Claude Brain draws (assets/*.bin.gz) from public neuroimaging data.

Sources (all from the niivue project's demo images, https://github.com/niivue/niivue, packages/niivue/demos/images):
  mni152_2009.mz3              ICBM152 2009 brain surface            (MNI / McGill, permissive licence, see THIRD_PARTY_NOTICES.md)
  MNI152_2009_template.nii.gz  ICBM152 2009 T1 template              (MNI / McGill)
  aal.nii.gz                   AAL atlas, 116 regions                (Tzourio-Mazoyer et al. 2002)
  yeh2022.trx                  HCP-1065 tractography atlas           (Yeh 2022, CC BY-SA 4.0)

Usage:
  python3 build_anat.py --images path/to/niivue/demos/images --mesh ../../assets/brain.bin.gz --out ../../assets
Needs numpy, scipy and scikit-image.
"""
import argparse, gzip, os, struct, zipfile
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage import measure
from nvio import read_nii, read_brainbin

ap = argparse.ArgumentParser()
ap.add_argument('--images', required=True, help='folder with the niivue demo images')
ap.add_argument('--mesh', required=True, help='brain.bin(.gz): the decimated ICBM152 2009 surface the plugin draws')
ap.add_argument('--out', required=True)
A = ap.parse_args()
IMG = A.images.rstrip('/') + '/'
OUT = A.out.rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)

def mni_to_three(p):   # scene coordinates of the plugin: three = (x, z - 10, -y - 15)
    p = np.asarray(p, dtype=np.float64)
    return np.stack([p[..., 0], p[..., 2] - 10, -p[..., 1] - 15], -1)
def three_to_mni(t): return np.stack([t[..., 0], -(t[..., 2] + 15), t[..., 1] + 10], -1)

pos, depth, lobe, idx = read_brainbin(A.mesh)
pos = pos.astype(np.float64)
nv = len(pos)
vn = np.zeros_like(pos)
tri = pos[idx]
fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
for k in range(3): np.add.at(vn, idx[:, k], fn)
vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-9

# ---------- 1. AAL label for every surface vertex (nearest labelled voxel, 2 mm under the surface) ----------
aal, aff, _, _ = read_nii(IMG + 'aal.nii.gz')
inv = np.linalg.inv(aff)
dist, inds = ndimage.distance_transform_edt(aal == 0, return_indices=True)
nearest = aal[tuple(inds)]
def sample(vol, aff_inv, mni):
    ijk = (aff_inv @ np.c_[mni, np.ones(len(mni))].T)[:3].T
    ijk = np.clip(np.rint(ijk).astype(int), 0, np.array(vol.shape) - 1)
    return vol[ijk[:, 0], ijk[:, 1], ijk[:, 2]]
labels = sample(nearest, inv, three_to_mni(pos - vn * 2.0)).astype(np.uint8)
print('vertex labels: unique', len(np.unique(labels)))
open(OUT + 'aal.bin', 'wb').write(b'CBA1' + struct.pack('<I', nv) + labels.tobytes())

# ---------- 2. inner structures: marching cubes ----------
def mesh_from_mask(mask, aff, sigma=1.0, step=1, smooth_iter=8):
    m = ndimage.gaussian_filter(mask.astype(np.float32), sigma)
    verts, faces, _, _ = measure.marching_cubes(np.pad(m, 2), 0.5, step_size=step)
    verts -= 2
    v = mni_to_three((aff @ np.c_[verts, np.ones(len(verts))].T)[:3].T)
    nbr = [[] for _ in range(len(v))]
    for a, b, c in faces:
        nbr[a] += [b, c]; nbr[b] += [a, c]; nbr[c] += [a, b]
    nbr = [np.unique(n) for n in nbr]
    for _ in range(smooth_iter):
        v = np.array([v[i] * 0.5 + v[n].mean(0) * 0.5 if len(n) else v[i] for i, n in enumerate(nbr)])
    return v, faces[:, ::-1].copy()

STRUCTS = [(1, 'Thalamus', [77, 78], 'relay'), (2, 'Caudate nucleus', [71, 72], 'basal'), (3, 'Putamen', [73, 74], 'basal'),
           (4, 'Globus pallidus', [75, 76], 'basal'), (5, 'Hippocampus', [37, 38], 'memory'), (6, 'Amygdala', [41, 42], 'salience')]
parts = []
for sid, name, labs, kind in STRUCTS:
    for side, lab in zip('LR', labs):
        v, f = mesh_from_mask(aal == lab, aff)
        parts.append((sid, name, side, kind, v, f))

# ---------- 3. T1 volume (ICBM152 2009), brain only, 1.25 mm, uint8 ----------
t1, taff, _, _ = read_nii(IMG + 'MNI152_2009_template.nii.gz')
sp = 1.25
lo = np.array([-74.0, -110.0, -72.0]); hi = np.array([74.0, 76.0, 86.0])
dims = np.ceil((hi - lo) / sp).astype(int)
gx, gy, gz = [lo[i] + sp * np.arange(dims[i]) for i in range(3)]
G = np.stack(np.meshgrid(gx, gy, gz, indexing='ij'), -1).reshape(-1, 3)
ijk = (np.linalg.inv(taff) @ np.c_[G, np.ones(len(G))].T)[:3]
vals = ndimage.map_coordinates(t1.astype(np.float32), ijk, order=1, mode='constant', cval=0).reshape(dims)
# brain mask from the ICBM152 2009 surface itself: a voxel is inside when it lies behind the surface normals of its
# nearest surface vertices (the surface is the outline of the brain the plugin draws, so slice and surface agree)
three = mni_to_three(G)
d_, nn = cKDTree(pos).query(three, k=4)
side = np.einsum('nkj,nkj->nk', three[:, None, :] - pos[nn], vn[nn]).mean(1)
mask = ndimage.binary_opening((side < 0.6).reshape(dims), iterations=1)
lab, n = ndimage.label(mask)
mask = ndimage.binary_fill_holes(lab == (np.argmax(ndimage.sum(mask, lab, range(1, n + 1))) + 1))
raw = vals.copy()
vals = vals * np.clip(ndimage.gaussian_filter(mask.astype(np.float32), 0.9) * 1.6 - 0.3, 0, 1)   # soft edge: no hard rim around the brain
mx = np.percentile(vals[vals > 0], 99.6)
vol = np.clip(vals / mx * 255, 0, 255).astype(np.uint8)
print('t1 dims', dims, 'brain voxels', int(mask.sum()))
open(OUT + 't1.bin', 'wb').write(b'CBV1' + struct.pack('<HHH', *dims) + struct.pack('<4f', *lo, sp) + np.ascontiguousarray(vol.transpose(2, 1, 0)).tobytes())

# ventricles: dark (CSF) voxels deep in the middle of the brain; opening removes the thin midline fissure
vox_aff = np.array([[sp, 0, 0, lo[0]], [0, sp, 0, lo[1]], [0, 0, sp, lo[2]], [0, 0, 0, 1.0]])
M = np.stack(np.meshgrid(gx, gy, gz, indexing='ij'), 0)
box = (np.abs(M[0]) < 34) & (M[1] > -48) & (M[1] < 34) & (M[2] > -14) & (M[2] < 36)
# (the surface leaves them out, so they are the dark holes left inside the closed brain)
closed = ndimage.binary_fill_holes(ndimage.binary_closing(mask, iterations=6))
wm = np.percentile(raw[ndimage.binary_erosion(mask, iterations=4)], 90)
csf = closed & ~mask & box & (raw < 0.45 * wm)
csf = ndimage.binary_opening(csf, structure=np.ones((3, 3, 3)), iterations=1)
lab, n = ndimage.label(csf)
sizes = ndimage.sum(csf, lab, range(1, n + 1))
keep = np.zeros_like(csf)
for i in np.argsort(sizes)[::-1][:3]:
    if sizes[i] > 400: keep |= lab == (i + 1)
v, f = mesh_from_mask(keep, vox_aff, sigma=1.0, step=1, smooth_iter=10)
parts.append((7, 'Ventricles', '', 'csf', v, f))
print('ventricles', len(v), 'verts')

b = bytearray(b'CBI1' + struct.pack('<B', len(parts)))
for sid, name, side, kind, v, f in parts:
    nm, sd, kd = name.encode(), side.encode(), kind.encode()
    b += struct.pack('<BB', sid, len(nm)) + nm + struct.pack('<B', len(sd)) + sd + struct.pack('<B', len(kd)) + kd
    b += struct.pack('<II', len(v), len(f)) + np.rint(v * 100).astype('<i2').tobytes() + f.astype('<u4').tobytes()
open(OUT + 'inner.bin', 'wb').write(bytes(b))

# ---------- 4. fibre tracts: a sample of the HCP-1065 tractography atlas ----------
z = zipfile.ZipFile(IMG + 'yeh2022.trx')
P = np.frombuffer(z.read('positions.3.float32'), '<f4').reshape(-1, 3).astype(np.float64)
O = np.r_[np.frombuffer(z.read('offsets.int32'), '<i4').astype(np.int64), len(P)]
tree = cKDTree(pos)
rng = np.random.default_rng(7)
bundles = []
for n in sorted(z.namelist()):
    if not n.startswith('groups/') or not n.endswith('.uint32'): continue
    key = n.split('/')[-1][:-7]
    if key.startswith('CN'): continue          # cranial nerves: tiny, outside the brain surface
    ids = np.frombuffer(z.read(n), '<u4').astype(np.int64)
    if not len(ids): continue
    pick = rng.choice(ids, size=min(int(np.clip(len(ids) * 0.06, 5, 36)), len(ids)), replace=False)
    lines = []
    for s in pick:
        pts = mni_to_three(P[O[s]:O[s + 1]])
        seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        if seg[-1] < 15: continue
        t = np.linspace(0, seg[-1], int(np.clip(seg[-1] / 4.0, 6, 48)))
        rs = np.stack([np.interp(t, seg, pts[:, i]) for i in range(3)], 1)
        lines.append((rs, int(lobe[tree.query(rs[0])[1]]), int(lobe[tree.query(rs[-1])[1]])))
    if lines: bundles.append((key, lines))
tb = bytearray(b'CBT1' + struct.pack('<H', len(bundles)))
for key, lines in bundles:
    kb = key.encode()
    tb += struct.pack('<B', len(kb)) + kb + struct.pack('<H', len(lines))
    for rs, ea, eb in lines: tb += struct.pack('<HBB', len(rs), ea, eb) + np.rint(rs * 10).astype('<i2').tobytes()
open(OUT + 'tracts.bin', 'wb').write(bytes(tb))
print('tracts', len(bundles), 'bundles', sum(len(l) for _, l in bundles), 'streamlines')

for f in ['aal.bin', 'inner.bin', 't1.bin', 'tracts.bin']:
    raw = open(OUT + f, 'rb').read()
    open(OUT + f + '.gz', 'wb').write(gzip.compress(raw, 9, mtime=0))
    os.remove(OUT + f)
    print(f + '.gz', os.path.getsize(OUT + f + '.gz'), 'bytes')
