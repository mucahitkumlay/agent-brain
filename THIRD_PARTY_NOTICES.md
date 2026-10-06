# Third-party notices

Agent Brain's own code is MIT-licensed (see `LICENSE`). That licence covers the code only: it does not cover the data
in `assets/`, and it grants no rights to any trademark (Claude, Claude Code, Anthropic, Obsidian). It bundles one library and draws on public neuroimaging data,
each under its own terms below. The data files in `assets/` were built with `tools/anatomy/build_anat.py` from files
distributed with the [niivue](https://github.com/niivue/niivue) project (`packages/niivue/demos/images`).

## Summary

| File | Derived from | Terms |
|---|---|---|
| `main.js` (release) | this repository + three.js | MIT (both) |
| `assets/brain.bin.gz` | ICBM152 2009 surface (niivue `mni152_2009.mz3`) | ICBM licence below: keep the copyright notice |
| `assets/t1.bin.gz` | ICBM152 2009 T1 template | ICBM licence below |
| `assets/inner.bin.gz` | ventricles from the ICBM152 2009 T1; thalamus, caudate, putamen, pallidum, hippocampus, amygdala from AAL | ICBM licence below; AAL attribution below |
| `assets/aal.bin.gz` | AAL atlas (one label per surface vertex) | AAL attribution below |
| `assets/tracts.bin.gz` | HCP-1065 tractography atlas | **CC BY-SA 4.0** |

### When you redistribute

If you copy, fork, bundle or change the plugin or its data, you must keep with it: `LICENSE`, this file, the ICBM
copyright notice, the AAL and HCP-1065 credits and citations, and the Human Connectome Project acknowledgement.
Changes to `tracts.bin.gz` (or anything else adapted from the HCP-1065 atlas) must be shared under CC BY-SA 4.0, and
you may not add terms or technical measures that restrict what CC BY-SA 4.0 allows. None of the data may be presented
as endorsed by its authors, and none of it is fit for clinical use.

## three.js (bundled into `main.js`)

MIT License. Copyright © 2010–2026 three.js authors. https://github.com/mrdoob/three.js

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and
> this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS
> PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## MNI ICBM152 2009 template — `brain.bin.gz`, `t1.bin.gz`, the brain mask and ventricles in `inner.bin.gz`

The brain surface (decimated from niivue's `mni152_2009.mz3`) and the T1 volume (resampled from
`MNI152_2009_template.nii.gz`) are derived from the ICBM152 2009 non-linear template,
https://www.mcgill.ca/bic/software/tools-data-analysis/anatomical-mri/atlases/icbm152-non-linear-2009

> Copyright (C) 1993–2004 Louis Collins, McConnell Brain Imaging Centre, Montreal Neurological Institute, McGill University.
> Permission to use, copy, modify, and distribute this software and its documentation for any purpose and without fee
> is hereby granted, provided that the above copyright notice appear in all copies. The authors and McGill University
> make no representations about the suitability of this software for any purpose. It is provided "as is" without
> express or implied warranty. The authors are not responsible for any data loss, equipment damage, property loss, or
> injury to subjects or patients resulting from the use or misuse of this software package.

Citations:
- V.S. Fonov, A.C. Evans, K. Botteron, C.R. Almli, R.C. McKinstry, D.L. Collins and BDCG. Unbiased average
  age-appropriate atlases for pediatric studies. NeuroImage 54(1), 2011. doi:10.1016/j.neuroimage.2010.07.033
- V.S. Fonov, A.C. Evans, R.C. McKinstry, C.R. Almli and D.L. Collins. Unbiased nonlinear average age-appropriate brain
  templates from birth to adulthood. NeuroImage 47 Suppl 1, 2009. doi:10.1016/S1053-8119(09)70884-5
- D.L. Collins, A.P. Zijdenbos, W.F.C. Baaré and A.C. Evans. ANIMAL+INSECT: Improved Cortical Structure Segmentation.
  IPMI 1999, LNCS 1613. doi:10.1007/3-540-48714-X_16

## AAL atlas — `aal.bin.gz` and the deep nuclei in `inner.bin.gz`

The gyrus label of each surface vertex and the meshes of the thalamus, caudate, putamen, pallidum, hippocampus and
amygdala are derived from the Automated Anatomical Labeling atlas (116 regions), as distributed in niivue's
`aal.nii.gz`. AAL is developed by the GIN-IMN group (Bordeaux), https://www.gin.cnrs.fr/en/tools/aal/

The original AAL release does not state a licence of its own (the later AAL3v2 release is distributed under the GNU
General Public Licence). The atlas is widely redistributed for research and visualisation, including by niivue, from
which these files were taken. Only derived data is included here: one label per surface vertex and six smoothed nucleus
meshes; the atlas volume itself is not. If you are a rights holder and object to this use, please open an issue and it
will be replaced.

Citation:
- N. Tzourio-Mazoyer, B. Landeau, D. Papathanassiou, F. Crivello, O. Etard, N. Delcroix, B. Mazoyer and M. Joliot.
  Automated anatomical labeling of activations in SPM using a macroscopic anatomical parcellation of the MNI MRI
  single-subject brain. NeuroImage 15(1), 2002. doi:10.1006/nimg.2001.0978

## HCP-1065 tractography atlas — `tracts.bin.gz`

`tracts.bin.gz` is a derivative of the population-averaged HCP-1065 tractography atlas by Fang-Cheng Yeh
(https://brain.labsolver.org/hcp_trk_atlas.html), distributed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).
Changes: a random sample of about 6 % of the streamlines of each bundle (cranial nerves left out), resampled every 4 mm
and moved into the plugin's coordinate frame. **`tracts.bin.gz` is therefore licensed under CC BY-SA 4.0.**

Citation:
- F.-C. Yeh. Population-based tract-to-region connectome of the human brain and its hierarchical topology.
  Nature Communications 13, 4933 (2022). doi:10.1038/s41467-022-32595-4

Data were provided in part by the Human Connectome Project, WU-Minn Consortium (Principal Investigators: David Van Essen
and Kamil Ugurbil; 1U54MH091657) funded by the 16 NIH Institutes and Centers that support the NIH Blueprint for
Neuroscience Research; and by the McDonnell Center for Systems Neuroscience at Washington University.

## niivue

The source files above were taken from the niivue project (BSD 2-Clause License, https://github.com/niivue/niivue),
whose readers and file formats (`.mz3`, `.trx`) this project also follows.
