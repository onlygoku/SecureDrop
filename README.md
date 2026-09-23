# SecureDrop

Private file encryption in your browser.

**Live:** https://securedropff.netlify.app/

SecureDrop is a privacy-focused file encryption application that lets you
encrypt and decrypt files directly in your browser.

No account. No file upload. No backend required for the encryption workflow.

---

## Live Application

Use SecureDrop here:

https://securedropff.netlify.app/

The application provides:

- File encryption
- File decryption
- Drag-and-drop file selection
- Password-based encryption
- AES-256-GCM encryption
- Argon2id key derivation
- Light and dark mode
- Browser-based processing
- `.sdrop` encrypted packages

---

## How It Works

## While Encrypting

SecureDrop performs the encryption workflow inside the browser.

```text
Your File
    │
    ▼
Password
    │
    ▼
Argon2id
    │
    ▼
Encryption Key
    │
    ▼
AES-256-GCM
    │
    ▼
.sdrop Package
``` 

### While Decrypting
```text
.sdrop Package
    │
    ▼
Password
    │
    ▼
Argon2id
    │
    ▼
Encryption Key
    │
    ▼
AES-256-GCM
    │
    ▼
Original File
```
Both workflows run directly in the user's browser. The current application does not require a SecureDrop backend to process the selected files.