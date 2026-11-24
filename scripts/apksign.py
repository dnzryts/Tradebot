"""Minimal APK Signature Scheme v2 signer/verifier (RSA PKCS#1 v1.5 + SHA-256).

Spec: https://source.android.com/docs/security/features/apksigning/v2
Usage:
  python3 apksign.py sign   in.apk out.apk key.p12 PASSWORD
  python3 apksign.py verify in.apk
"""
import hashlib, struct, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography import x509

V2_ID = 0x7109871A
ALG_RSA_PKCS1_SHA256 = 0x0103
MAGIC = b"APK Sig Block 42"
CHUNK = 1 << 20

u32 = lambda n: struct.pack("<I", n)
u64 = lambda n: struct.pack("<Q", n)
lp = lambda b: u32(len(b)) + b  # uint32 length-prefixed


def find_eocd(data):
    for i in range(len(data) - 22, max(-1, len(data) - 22 - 65536), -1):
        if data[i:i + 4] == b"PK\x05\x06" and struct.unpack_from("<H", data, i + 20)[0] == len(data) - i - 22:
            return i
    raise ValueError("EOCD not found")


def split(data):
    """Return (entries, sig_block_or_None, central_dir, eocd) with eocd's CD offset normalised."""
    eocd_off = find_eocd(data)
    cd_size, cd_off = struct.unpack_from("<II", data, eocd_off + 12)
    if cd_off + cd_size != eocd_off:
        raise ValueError("ZIP has data between central directory and EOCD")
    block_start = cd_off
    if data[cd_off - 16:cd_off] == MAGIC:
        size = struct.unpack_from("<Q", data, cd_off - 24)[0]
        block_start = cd_off - size - 8
    entries = data[:block_start]
    block = data[block_start:cd_off] if block_start != cd_off else None
    cd = data[cd_off:eocd_off]
    eocd = bytearray(data[eocd_off:])
    struct.pack_into("<I", eocd, 16, block_start)  # digest uses offset of where the block begins
    return entries, block, cd, bytes(eocd)


def content_digest(sections):
    chunk_digests = []
    for sec in sections:
        for i in range(0, len(sec), CHUNK):
            part = sec[i:i + CHUNK]
            chunk_digests.append(hashlib.sha256(b"\xa5" + u32(len(part)) + part).digest())
    return hashlib.sha256(b"\x5a" + u32(len(chunk_digests)) + b"".join(chunk_digests)).digest()


def check_alignment(entries):
    """Uncompressed entries must be 4-byte aligned; resources.arsc must be stored (Android 11+)."""
    off, bad = 0, []
    while entries[off:off + 4] == b"PK\x03\x04":
        method, = struct.unpack_from("<H", entries, off + 8)
        csize, = struct.unpack_from("<I", entries, off + 18)
        nlen, xlen = struct.unpack_from("<HH", entries, off + 26)
        flags, = struct.unpack_from("<H", entries, off + 6)
        name = entries[off + 30:off + 30 + nlen].decode()
        data_off = off + 30 + nlen + xlen
        if method == 0 and data_off % 4:
            bad.append(name)
        if name == "resources.arsc" and method != 0:
            bad.append("resources.arsc (compressed)")
        off = data_off + csize + (16 if flags & 8 else 0)
    return bad


def sign(src, dst, p12, password):
    data = open(src, "rb").read()
    entries, _old, cd, eocd = split(data)
    bad = check_alignment(entries)
    if bad:
        raise SystemExit(f"Not zip-aligned: {bad[:5]}")
    key, cert, _ = pkcs12.load_key_and_certificates(open(p12, "rb").read(), password.encode())
    digest = content_digest([entries, cd, eocd])
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    signed_data = (lp(lp(u32(ALG_RSA_PKCS1_SHA256) + lp(digest)))  # digests
                   + lp(lp(cert_der))                               # certificates
                   + lp(b""))                                       # additional attributes
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = lp(signed_data) + lp(lp(u32(ALG_RSA_PKCS1_SHA256) + lp(sig))) + lp(pub)
    value = lp(lp(signer))
    pair = u64(4 + len(value)) + u32(V2_ID) + value
    size = len(pair) + 8 + 16
    block = u64(size) + pair + u64(size) + MAGIC
    out_eocd = bytearray(eocd)
    struct.pack_into("<I", out_eocd, 16, len(entries) + len(block))
    open(dst, "wb").write(entries + block + cd + bytes(out_eocd))


def read_lp(buf, off):
    n, = struct.unpack_from("<I", buf, off)
    return buf[off + 4:off + 4 + n], off + 4 + n


def verify(path):
    data = open(path, "rb").read()
    entries, block, cd, eocd = split(data)
    assert block, "no APK Signing Block"
    off, end, v2 = 8, len(block) - 24, None
    while off < end:
        n, = struct.unpack_from("<Q", block, off); pid, = struct.unpack_from("<I", block, off + 8)
        if pid == V2_ID: v2 = block[off + 12:off + 8 + n]
        off += 8 + n
    assert v2, "no v2 signature"
    signers, _ = read_lp(v2, 0); signer, _ = read_lp(signers, 0)
    signed_data, o = read_lp(signer, 0); sigs, o = read_lp(signer, o); pub, _ = read_lp(signer, o)
    sig_entry, _ = read_lp(sigs, 0); alg, = struct.unpack_from("<I", sig_entry, 0); sig, _ = read_lp(sig_entry, 4)
    pubkey = serialization.load_der_public_key(pub)
    pubkey.verify(sig, signed_data, padding.PKCS1v15(), hashes.SHA256())  # raises if invalid
    digests, o = read_lp(signed_data, 0); certs, _ = read_lp(signed_data, o)
    d, _ = read_lp(digests, 0); dalg, = struct.unpack_from("<I", d, 0); dig, _ = read_lp(d, 4)
    assert dalg == alg == ALG_RSA_PKCS1_SHA256
    assert dig == content_digest([entries, cd, eocd]), "content digest mismatch"
    cert_der, _ = read_lp(certs, 0); cert = x509.load_der_x509_certificate(cert_der)
    assert cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) == pub
    print("v2 signature VALID")
    print("signer:", cert.subject.rfc4514_string())
    print("cert SHA-256:", ":".join(f"{b:02X}" for b in hashlib.sha256(cert_der).digest()))
    print("alignment issues:", check_alignment(entries) or "none")


if __name__ == "__main__":
    if sys.argv[1] == "sign": sign(*sys.argv[2:6])
    else: verify(sys.argv[2])
