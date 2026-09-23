# SecureDrop Web

A local-first browser implementation of SecureDrop.

## Run

Open CMD inside the SecureDrop-Web folder:

    py -m http.server 8080

Then open:

    http://localhost:8080

Do not open index.html directly with file:// if you want PWA/service-worker behavior.

## Features

- Apple-inspired interface
- Zinc typography
- Encrypt / Decrypt
- Drag and drop
- AES-256-GCM
- Argon2id
- Local browser processing
- No account
- No backend
- No file upload
- Dark mode
- PWA support
- Responsive design

## Security

The browser derives a 256-bit encryption key using Argon2id.

Parameters:

- Memory: 64 MiB
- Iterations: 3
- Parallelism: 2
- Salt: 128 bits
- AES-GCM nonce: 96 bits

Files are encrypted locally using the Web Crypto API.

## Development note

The browser implementation uses a versioned browser .sdrop format.

It should not be assumed to be byte-compatible with the existing Python desktop SecureDrop format until the Python crypto serialization is explicitly ported.

## Production

Before production release:

1. Bundle Argon2 locally instead of relying on the CDN.
2. Serve the application over HTTPS.
3. Add proper PWA icons.
4. Add large-file streaming/chunking.
5. Add folder packaging.
6. Add automated cryptographic interoperability tests.