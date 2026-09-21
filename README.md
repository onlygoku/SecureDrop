# SecureDrop

SecureDrop is a small Windows desktop utility for putting files and folders into encrypted `.sdrop` packages. It has no account, cloud service, or telemetry.

## Run

```powershell
py -m pip install -r requirements.txt
py app.py
```

## Security design

- Encryption: AES-256-GCM
- Password derivation: Argon2id (64 MiB memory, 3 iterations, 2 lanes)
- Package contents: a ZIP archive encrypted as one authenticated payload
- Passwords are never written to disk or retained after an operation.

The format is versioned and documented in `docs/format.md`. This first version writes a temporary ZIP alongside the output while packaging; it is securely deleted when the operation finishes, but encryption is not suitable for data that must never temporarily exist unencrypted on disk.

## Build a Windows executable

```powershell
.\build.ps1
```

For a production release, use a code-signing certificate and an installer (for example WiX) to register the `.sdrop` association. `installer-association.reg` documents the equivalent registry keys. The application accepts an `.sdrop` path as its first argument, which is the installer integration point.

## Test

```powershell
py -m pytest
```
