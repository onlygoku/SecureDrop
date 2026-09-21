# `.sdrop` format, version 1

An `.sdrop` file contains one password-protected, authenticated payload.

```
offset  size        value
0       8           ASCII `SDROP001`
8       4           unsigned little-endian header length
12      header size  UTF-8 JSON header
...     variable     AES-256-GCM ciphertext
EOF-16  16           GCM authentication tag
```

The JSON header has a `version`, a `cipher` value of `AES-256-GCM`, and an `argon2id` object containing salt and parameters. The exact bytes from the magic through the JSON header are authenticated as additional authenticated data. The plaintext is a standard ZIP archive. Archive member names are validated during extraction to prevent path traversal.

Changing a header or using an incorrect password causes authentication to fail. Format compatibility is deliberately versioned rather than inferred.
