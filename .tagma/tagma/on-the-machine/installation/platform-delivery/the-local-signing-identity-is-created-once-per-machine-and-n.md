---
id: 01a10492-c27e-7eba-8137-4f3e4915e590
title: "The local signing identity is created once per machine and never silently recreated: replacing it resets every macOS permission granted to Tagma"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/setup/signing.ts
---
macOS permissions are bound to the signing requirement `identifier … and certificate leaf = H"…"` : a new certificate is a new app for TCC ([[c3dad364|the TCC study]]). So when the "Tagma Local Signing" identity exists but does not fit — expired, lost its key, there are several — the build refuses and names deletion in unblock, warning about the permission reset. Only a build that found no identity at all creates one.

- **The login keychain, not a separate one.** `codesign` finds the identity only in the user search list. A separate keychain would have to be opened with a password from a file next to it, while any user process would read that password and sign someone else's code with the local signing identity.
- **Key access.** Importing with `-T /usr/bin/codesign -x` never sets the partition list: that requires the login password. So the first signing asks for access. "Allow" asks on every signing (about 15 per build), "Always Allow" — once. Hence the `signingNotice` line the build prints before every bundle signing, without claiming access is already granted. There is no trial signing: it would be one more key touch. When there is no access, build-host returns a structured refusal (`contract/wire/hostRefusal.ts`) with codesign's reason and a way to restore access, and release lays it into `ReleaseRefused`.
- **The identity is recognized by certificate, not by label.** Its own is the `find-identity` line with either the "Tagma Local Signing" label or a certificate fingerprint with CN "Tagma Local Signing" (read through `find-certificate -a -c "Tagma Local Signing" -p`: measured on a temp keychain that `-c` matches CN by substring, not the label, so the build itself verifies the exact CN match). Otherwise a label renamed in Keychain Access would read as "no identity", and the build would issue a new one. An answer that fails to parse is a refusal, not an "absence".
- **Creation is serialized** with the `~/.tagma/signing.lock` lock. Without the lock only one healthy identity passes; any other outcome, including refusal, is re-read and decided under the lock, and the import result is verified there too. Otherwise two builds on a fresh machine would import two identities, or the second would see a certificate whose key has not appeared yet.
- **Who authorizes the identity.** Release passes the fingerprint into build-host through `TAGMA_SIGNING_IDENTITY`. Without that variable (`bun run build`, the dev stand) build-host finds the identity itself.
- **Accepted risk: someone else's code.** After "Always Allow" any process of the same user can sign its code with the local signing identity through `/usr/bin/codesign` and gain its TCC permissions. That is the price of the login keychain, and it touches the developer machine only.
- **Accepted risk: creation.** While the identity is being created, the key lies open for seconds in a 0700 temp directory, and the p12 password shows in argv.
- **The certificate.** It is made by `/usr/bin/openssl` (LibreSSL), because the keychain accepts an OpenSSL 3 p12 only with `-legacy`. Without `keyUsage=digitalSignature` and `basicConstraints` codesign on macOS 26.0.1 answered "no identity found". codesign accepted the term through the end of year 9999.
- **The key name.** In a file keychain `pkcs12 -name` becomes the key label. On the key imported into login on 2026-10-04 the label is still "Imported Private Key". Why is not established; the existing key was left alone.
