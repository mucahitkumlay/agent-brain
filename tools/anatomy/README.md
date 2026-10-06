# Anatomy data

`build_anat.py` makes four of the five files in `assets/`; the fifth, `brain.bin.gz`, is its input.

| File | What it holds | Made from |
|---|---|---|
| `brain.bin.gz` | brain surface: 79,886 vertices (int16, 1/100 mm), sulcal depth and lobe per vertex, 167,125 triangles | ICBM152 2009 surface (`mni152_2009.mz3`), decimated to about a quarter of its vertices |
| `aal.bin.gz` | the AAL gyrus (1–116) of every surface vertex | `aal.nii.gz`, sampled 2 mm under the surface |
| `inner.bin.gz` | meshes of the thalamus, caudate, putamen, pallidum, hippocampus, amygdala (left and right) and the ventricles | `aal.nii.gz` (nuclei), `MNI152_2009_template.nii.gz` (ventricles) |
| `t1.bin.gz` | brain-only T1 volume, 1.25 mm, uint8, for the MRI slices | `MNI152_2009_template.nii.gz`, masked with the surface |
| `tracts.bin.gz` | 1,158 streamlines in 77 bundles, with the lobe at each end | `yeh2022.trx` (HCP-1065 atlas) |

Licences and citations: see `THIRD_PARTY_NOTICES.md`.

## Rebuilding

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/niivue/niivue
cd niivue && git sparse-checkout set packages/niivue/demos/images && cd ..
python3 -m pip install numpy scipy scikit-image
python3 build_anat.py --images niivue/packages/niivue/demos/images --mesh ../../assets/brain.bin.gz --out ../../assets
```

The output is deterministic (fixed random seed, gzip without timestamps). After rebuilding, `node tools/prepare.mjs`
refreshes the checksums the plugin uses to verify downloaded files.

## Formats

All little-endian. Scene coordinates are millimetres with `three = (x, z − 10, −y − 15)` for MNI `(x, y, z)`.

- `CBR1` brain: `u32 nv, u32 nf, i16 pos[nv*3] (×0.01 mm), u8 depth[nv] (0 = sulcal fundus … 255 = gyral crown), u8 lobe[nv], u32 idx[nf*3]`.
  Lobes: 0 frontal, 1 motor, 2 parietal, 3 temporal, 4 occipital, 5 cerebellum, 6 thalamus, 7 brain stem.
- `CBA1` labels: `u32 nv, u8 label[nv]` (AAL index, 0 = none).
- `CBI1` inner: `u8 n`, then per part `u8 id, u8 len, name, u8 len, side, u8 len, kind, u32 nv, u32 nf, i16 pos[nv*3] (×0.01 mm), u32 idx[nf*3]`.
- `CBV1` volume: `u16 nx, ny, nz, f32 lo[3] (MNI mm), f32 spacing, u8 voxels` (x fastest).
- `CBT1` tracts: `u16 bundles`, then per bundle `u8 len, name, u16 lines`, per line `u16 points, u8 lobeA, u8 lobeB, i16 pts[points*3] (×0.1 mm)`.
