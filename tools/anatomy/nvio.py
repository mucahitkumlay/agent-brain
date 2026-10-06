import gzip, struct, numpy as np, zipfile, json
IMG = ''   # set by build_anat.py (--images)
def read_mz3(path):
    b = open(path, 'rb').read()
    if b[:2] == b'\x1f\x8b': b = gzip.decompress(b)
    magic, attr, nface, nvert, nskip = struct.unpack('<HHIII', b[:16])
    assert magic == 0x5A4D, hex(magic)
    o = 16 + nskip
    out = {'attr': attr}
    if attr & 1: out['faces'] = np.frombuffer(b, '<i4', nface * 3, o).reshape(-1, 3); o += nface * 12
    if attr & 2: out['verts'] = np.frombuffer(b, '<f4', nvert * 3, o).reshape(-1, 3); o += nvert * 12
    if attr & 4: out['rgba'] = np.frombuffer(b, 'u1', nvert * 4, o).reshape(-1, 4); o += nvert * 4
    if attr & 8:
        n = (len(b) - o) // 4
        out['scalar'] = np.frombuffer(b, '<f4', n, o)
    return out
def read_nii(path):
    b = gzip.decompress(open(path, 'rb').read()) if path.endswith('.gz') else open(path, 'rb').read()
    sizeof_hdr = struct.unpack('<i', b[:4])[0]; assert sizeof_hdr == 348, sizeof_hdr
    dim = struct.unpack('<8h', b[40:56]); datatype = struct.unpack('<h', b[70:72])[0]; bitpix = struct.unpack('<h', b[72:74])[0]
    pixdim = struct.unpack('<8f', b[76:108]); vox_offset = struct.unpack('<f', b[108:112])[0]
    scl_slope, scl_inter = struct.unpack('<2f', b[112:120])
    qform_code, sform_code = struct.unpack('<2h', b[252:256])
    srow = np.array(struct.unpack('<12f', b[280:328])).reshape(3, 4)
    dt = {2: 'u1', 4: '<i2', 8: '<i4', 16: '<f4', 64: '<f8', 256: 'i1', 512: '<u2', 768: '<u4'}[datatype]
    nx, ny, nz = dim[1], dim[2], dim[3]
    data = np.frombuffer(b, dt, nx * ny * nz, int(vox_offset)).reshape(nz, ny, nx).transpose(2, 1, 0)
    if scl_slope not in (0, 1): data = data * scl_slope + scl_inter
    aff = np.vstack([srow, [0, 0, 0, 1]]) if sform_code > 0 else None
    if aff is None:  # qform
        qb, qc, qd, qx, qy, qz = struct.unpack('<6f', b[256:280]); qa = np.sqrt(max(0, 1 - qb*qb - qc*qc - qd*qd))
        R = np.array([[qa*qa+qb*qb-qc*qc-qd*qd, 2*(qb*qc-qa*qd), 2*(qb*qd+qa*qc)], [2*(qb*qc+qa*qd), qa*qa+qc*qc-qb*qb-qd*qd, 2*(qc*qd-qa*qb)], [2*(qb*qd-qa*qc), 2*(qc*qd+qa*qb), qa*qa+qd*qd-qc*qc-qb*qb]])
        qfac = pixdim[0] if pixdim[0] in (-1, 1) else 1
        aff = np.eye(4); aff[:3, :3] = R @ np.diag([pixdim[1], pixdim[2], pixdim[3] * qfac]); aff[:3, 3] = [qx, qy, qz]
    return data, aff, (sform_code, qform_code), pixdim[1:4]
def read_brainbin(path):
    b = gzip.decompress(open(path, 'rb').read()) if path.endswith('.gz') else open(path, 'rb').read()
    assert b[:4] == b'CBR1'
    nv, nf = struct.unpack('<II', b[4:12]); o = 12
    pos = np.frombuffer(b, '<i2', nv * 3, o).reshape(-1, 3) / 100.0; o += nv * 6
    depth = np.frombuffer(b, 'u1', nv, o); o += nv
    lobe = np.frombuffer(b, 'u1', nv, o); o += nv
    idx = np.frombuffer(b, '<u4', nf * 3, o).reshape(-1, 3)
    return pos, depth, lobe, idx
