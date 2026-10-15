"""
Generate a self-signed SSL certificate that:
  - Includes ALL current LAN IPs automatically in the SAN
  - Works in Chrome, Edge, Safari (mobile) without persistent warnings
    once the certificate is trusted on each device
  - 825-day validity  |  SHA-256  |  RSA 2048  |  CA=True (self-trustable)

Run:  python gen_cert.py
Then follow the printed instructions to install on each device.
"""

import datetime, ipaddress, os, socket
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID


# ── Auto-detect all local IPs ─────────────────────────────────────────────────
def get_local_ips():
    ips = set()
    try:
        # Get all IPs bound to this machine
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            try:
                ip = ipaddress.ip_address(addr)
                # Skip link-local (169.254.x.x) and loopback — add them separately
                if not ip.is_link_local:
                    ips.add(ip)
            except ValueError:
                pass
    except Exception:
        pass

    # Always include loopback
    ips.add(ipaddress.IPv4Address("127.0.0.1"))
    ips.add(ipaddress.IPv6Address("::1"))
    return sorted(ips, key=lambda x: str(x))


local_ips = get_local_ips()
print("Detected local IPs to include in certificate SAN:")
for ip in local_ips:
    print(f"  {ip}")
print()

# ── Generate RSA key ──────────────────────────────────────────────────────────
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

# ── Build SAN list ────────────────────────────────────────────────────────────
san_entries = [
    x509.DNSName("localhost"),
    x509.DNSName("attendai.local"),
]
for ip in local_ips:
    san_entries.append(x509.IPAddress(ip))

# ── Build certificate ─────────────────────────────────────────────────────────
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME,        "IN"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME,   "AttendAI Dev"),
    x509.NameAttribute(NameOID.COMMON_NAME,         "attendai.local"),
])

now = datetime.datetime.now(datetime.timezone.utc)

cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(now)
    .not_valid_after(now + datetime.timedelta(days=825))
    .add_extension(
        x509.SubjectAlternativeName(san_entries),
        critical=False,
    )
    .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
    .add_extension(
        x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
        critical=False,
    )
    .add_extension(
        x509.KeyUsage(
            digital_signature=True, key_cert_sign=True, crl_sign=True,
            content_commitment=False, key_encipherment=True,
            data_encipherment=False, key_agreement=False,
            encipher_only=False, decipher_only=False,
        ),
        critical=True,
    )
    .sign(key, hashes.SHA256())
)

base = os.path.dirname(os.path.abspath(__file__))

# ── Write files ───────────────────────────────────────────────────────────────
with open(os.path.join(base, "key.pem"), "wb") as f:
    f.write(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))

cert_bytes = cert.public_bytes(serialization.Encoding.PEM)
with open(os.path.join(base, "cert.pem"), "wb") as f:
    f.write(cert_bytes)

# Also write a .crt copy — Android/iOS prefer this extension for install
with open(os.path.join(base, "attendai.crt"), "wb") as f:
    f.write(cert_bytes)

# Get LAN IP (non-loopback IPv4) for display
lan_ip = next(
    (str(ip) for ip in local_ips
     if isinstance(ip, ipaddress.IPv4Address) and not ip.is_loopback),
    "10.x.x.x"
)

print("✅  cert.pem, key.pem and attendai.crt generated successfully.")
print()
print("=" * 62)
print("  SANs included in this certificate:")
print("=" * 62)
for e in san_entries:
    print(f"  {e}")
print()
print("=" * 62)
print("  HOW TO REMOVE THE WARNING ON EACH DEVICE")
print("=" * 62)
print()
print("  ── WINDOWS PC (Chrome / Edge) ──────────────────────────")
print("  Already done if you ran this before. If not:")
print("  1. Double-click  cert.pem")
print("  2. Install Certificate → Local Machine")
print("  3. Place in  'Trusted Root Certification Authorities'")
print("  4. Finish → Yes → restart browser")
print()
print("  ── ANDROID (Chrome) ────────────────────────────────────")
print("  Method 1 — Download & install (recommended):")
print(f"  1. On phone, open  http://{lan_ip}:5173/attendai.crt")
print("     (Vite will serve the file from the project root)")
print("  2. Android prompts 'Install certificate'")
print("  3. Choose  'CA Certificate'  (or VPN & Apps)")
print("  4. Name it  'AttendAI'  and confirm")
print("  5. Restart Chrome — warning gone ✓")
print()
print("  Method 2 — Via Settings:")
print("  Settings → Security → More security settings")
print("    → Install from device storage → find attendai.crt")
print()
print("  ── iOS / iPadOS (Safari) ───────────────────────────────")
print(f"  1. On iPhone, open  http://{lan_ip}:5173/attendai.crt")
print("  2. 'Profile Downloaded' appears — tap Close")
print("  3. Settings → General → VPN & Device Management")
print("  4. Tap the AttendAI profile → Install → Install")
print("  5. Settings → General → About → Certificate Trust Settings")
print("  6. Toggle ON 'attendai.local' → Continue")
print("  7. Restart Safari — warning gone ✓")
print()
print("  ── QUICK BYPASS (no install, works immediately) ────────")
print(f"  1. On phone open:  https://{lan_ip}:5443")
print("  2. Tap Advanced → 'Proceed to site (unsafe)'")
print(f"  3. Then use:       http://{lan_ip}:5173/")
print("  ⚠  Must repeat this step whenever the server restarts")
print("     and the browser clears the exception.")
print()
