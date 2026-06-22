# Security Audit & Fixes

## Summary

A targeted security review of the zed-sftp extension identified **11 issues** ranging
from critical (no SSH host key verification — silent MITM on every connection) to
informational (path-traversal string scans and stale connection flags). All 11 have
been addressed in the changes following this audit. **98 tests across 14 suites**
now exercise the security-critical code paths; the project previously had zero tests.

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | No SSH host key verification (TOFU bypass) | **High** | Fixed |
| 2 | Context-path `startsWith` boundary bug | **High** | Fixed |
| 3 | Naive `~` expansion in `privateKeyPath` | Medium | Fixed |
| 4 | Path-traversal `includes("..")` check | Medium | Fixed (removed) |
| 5 | Plaintext credentials in `.zed/sftp.json` | Medium | Fixed (A+B+C) |
| 6 | Weak / deprecated algorithms documented | Medium | Fixed |
| 7 | `algorithms` config parsed but never applied | Medium | Fixed (regression test added) |
| 8 | `uploadOnSave` unconditionally triggers on any save | Low (by design) | Confirmation prompts added for manual commands |
| 9 | `protocol: "ftp" | "ftps"` declared, only SFTP implemented | Low (misleading) | Fixed (A+B) |
| 10 | `saveConfig()` writes to disk without permission check | Low (dead code) | Removed |
| 11 | Supply-chain risk via npm `latest` fetch | **High** | Fixed (version pin) |

---

## Issue 1 — No SSH host key verification

**Severity:** High. Every prior connection was MITM-able with no warning.

**Where:** `server/src/sftp-client.ts` `connect()` (old version).

**The vulnerability:** `ssh2-sftp-client` defaults to *not* verifying the server's
host key. A network attacker could intercept the connection, present their own SSH
server, and silently receive uploaded files (including credentials).

**The fix:**
- New fields on `SftpConfig`: `hostKey` (SHA256 fingerprint), `knownHostsPath`,
  `verifyHostKey` (default `true`).
- New module `server/src/host-verifier.ts` with:
  - `shouldEnforceHostKey(opts)` — pure decision function
  - `makeHostVerifier(fingerprint)` — constant-time SHA256 comparison
- `connect()` (now `buildConnectConfig()` in `connect-config.ts`) refuses the
  connection if verification is required but no fingerprint is configured, and
  passes `hostHash: 'sha256'` + `hostVerifier` to ssh2.
- Loud warning on every connection when `verifyHostKey: false`.

**Breaking change:** Existing configs without `hostKey` now get a connection
refusal with a `ssh-keyscan` one-liner in the error message.

**Tests:** `server/test/host-verifier.test.ts` — 21 tests covering format
acceptance (OpenSSH `SHA256:<base64>` padded/unpadded, bare hex), match/mismatch,
case-insensitivity, malformed input rejection, and enforcement policy.

---

## Issue 2 — Context-path `startsWith` boundary bug

**Severity:** High. Files outside the configured context were being uploaded.

**Where:** `server/src/config.ts` `isInContext()` (old version):
```ts
return normalized.startsWith(contextNormalized);
```

**The vulnerability:** For context `/work/site/wp-content` and file
`/work/site/wp-content-evil/leak.txt`, `startsWith` returns `true` even though
the file is in a *sibling* directory. A malicious or misnamed directory could
exfiltrate via the same remote root.

**The fix:**
- `isInContext` now uses a separator-aware boundary:
  ```ts
  if (normalized === contextNormalized) return true;
  const boundary = contextNormalized + path.sep;
  return normalized.length > boundary.length
      && normalized.startsWith(boundary);
  ```
- Handles trailing separator on context (e.g. `/work/site/wp-content/`).
- Preserves the filesystem root (`/`) as its own boundary.

**Tests:** `server/test/config.test.ts` — 11 tests in the
`ConfigManager.isInContext` suite, including the exact sibling-prefix scenario
(`/work/proj/site/wp-content` vs `/work/proj/site/wp-content-evil/...`).

---

## Issue 3 — Naive `~` expansion in `privateKeyPath`

**Severity:** Medium.

**Where:** `server/src/sftp-client.ts` (old version):
```ts
const keyPath = this.config.privateKeyPath.replace('~', process.env.HOME || '');
```

**The vulnerability:** Three problems:
1. `.replace('~', …)` only replaces the **first** `~` — mid-path occurrences
   like `/etc/~foo` got `process.env.HOME` injected mid-string.
2. Second-`~` cases like `~/.ssh/~/key` left the inner `~` literal.
3. `|| ''` fallback when `HOME` is unset produced relative paths from CWD.

**The fix:**
- New module `server/src/path-utils.ts` with `expandHome(p)`:
  - Only matches `~` at the start of the path
  - Supports `~/`, `~\`, and bare `~`
  - Uses `os.homedir()` so it works on Windows and when `HOME` is unset
  - Falls back to passing the path through unchanged for unsupported forms
- `connect()` (now `buildConnectConfig`) also adds an `fs.existsSync` check
  before `readFileSync`, giving a clear `"Private key not found at <path>"`
  error instead of a stack trace on typos.

**Tests:** `server/test/path-utils.test.ts` — 13 tests including the
mid-path `~` non-expansion, second-`~` non-expansion, `~user/...` passthrough,
and `HOME` unset behavior.

---

## Issue 4 — Path-traversal check is a string `includes`

**Severity:** Medium (false positives on legitimate filenames).

**Where:** `server/src/config.ts` `getRemotePath()` (old version).

**The vulnerability:** The code had two `if (relativePath.includes(".."))` blocks
that were:
1. **Redundant** — `path.relative()` already normalizes `..` segments away.
2. **False positives** — a file legitimately named `version..1.0.txt` would
   throw "Path traversal detected" and refuse to upload.
3. The second check (on `path.posix.join` output) was dead code — `path.posix.join`
   normalizes too.

**The fix:** Removed both `includes("..")` blocks. The actual security boundary
is `isInContext()` (fixed in #2). A comment in `getRemotePath()` documents the
new security model.

**Tests:** `server/test/config.test.ts` — 8 tests in the
`ConfigManager.getRemotePath` suite, including the false-positive cases
(`version..1.0.txt`, `draft...final/notes.md`) that previously would have thrown.

---

## Issue 5 — Plaintext credentials in `.zed/sftp.json`

**Severity:** Medium.

**Where:** `SftpConfig.password` and `SftpConfig.passphrase` are plain string
fields. The `.gitignore` did not exclude `.zed/`. Examples showed plaintext
passwords.

**The vulnerability:** Users who committed `sftp.json` to a public repo (or any
shared history) leaked their SFTP password forever.

**The fix (A + B + C):**

**A. `.gitignore`** — added `.zed/sftp.json` so accidental `git add` won't
commit credentials.

**B. README docs** — new "Security" section with the `$VAR` env-var syntax,
plus a clear warning that `.gitignore` only protects against `git add`, not
shell history or backup tools.

**C. Env-var resolution** — new module `server/src/env.ts` with `resolveEnv(value)`:
- `"$VAR"` → `process.env.VAR`, throws with a clear error if unset
- Strict env-var name validation (`^[A-Za-z_][A-Za-z0-9_]*$`) so `"$$"`,
  `"$1foo"`, `"$foo.bar"` etc. pass through as literals
- `ConfigManager.loadConfig()` calls `resolveEnv` on `password` and `passphrase`
  *after* profile merge, so profiles can also use `$VAR` syntax

**Tests:** `server/test/env.test.ts` — 9 tests covering all the edge cases,
plus 4 integration tests in `config.test.ts` that write real temp configs and
verify the resolution happens through `loadConfig`.

**Example config update:** `examples/ftp-config.example.json` (deleted in #9)
was the one that showed `"password": "CHANGE_ME"` — now the project uses
SSH-key auth exclusively.

---

## Issue 6 — Weak / deprecated algorithms documented

**Severity:** Medium.

**Where:** `examples/sftp-config.example.json` `algorithms` block.

**The vulnerability:** The example listed `diffie-hellman-group14-sha1`,
`hmac-sha1`, and `ssh-rsa` alongside modern algorithms. SHA-1 has been
formally deprecated since 2017 (NIST) and OpenSSH 9.6 disabled several
SHA-1 algorithms by default in 2024.

**The fix:** Replaced the example's `algorithms` block with ssh2's preferred
modern list (Curve25519 → ECDSA P-521/384/256 → DH-group-exchange-sha256 →
DH-group16/18-sha512; ChaCha20-Poly1305 → AES-GCM → AES-CTR; ED25519 → ECDSA →
rsa-sha2-512/256; ETM HMACs first). Added a paragraph in the README Security
section explaining the choices.

Note: With issue #7's fix, the `algorithms` field is now actually wired through
to ssh2, so this change is provably effective.

---

## Issue 7 — `algorithms` config parsed but never applied

**Severity:** Medium (the field was dead config).

**Where:** `server/src/config.ts` declared `algorithms`; nothing in
`sftp-client.ts` assigned `connectConfig.algorithms`.

**The vulnerability:** Users who customized `algorithms` to harden their
connection weren't — ssh2 used its built-in defaults regardless.

**The fix:**
1. `connect()` now wires `algorithms` through to ssh2 via
   `connectConfig.algorithms = config.algorithms`.
2. **Refactor for testability:** extracted `buildConnectConfig(config, log?)`
   into a new `server/src/connect-config.ts` module. This is the single place
   where `SftpConfig` fields are translated into ssh2 connect options.
3. **Documentation:** added a JSDoc block at the top of `SftpConfig` listing
   which fields are wired through (and pointing to `connect-config.ts`).
4. **Regression test suite:** `server/test/connect-config.test.ts` has a
   dedicated `algorithms (issue #7 regression)` suite with 4 tests. If a
   future refactor drops the wiring, this suite fails loudly.

---

## Issue 8 — `uploadOnSave` unconditional; manual ops get no confirmation

**Severity:** Low (by design for `uploadOnSave`); confirmation prompts for
manual ops are a UX choice.

**Where:** `server/src/index.ts` command handlers.

**The fix (manual commands only):**
- Added `confirmOperations?: boolean` to `SftpConfig` (default `true`).
- New module `server/src/confirm.ts` with `confirmOperation(showInfo, prompt,
  confirmLabel, cancelLabel?)` — testable in isolation.
- Each manual command (`sftp.upload`, `sftp.download`, `sftp.sync`,
  `sftp.uploadFolder`, `sftp.downloadFolder`) now:
  1. Resolves the remote path via `configManager.getRemotePath()`
  2. Shows an error and aborts if the path is outside context (fixes a
     pre-existing bug where "Uploaded: …" was shown even when the upload
     silently did nothing)
  3. Shows an LSP confirmation dialog with host + paths + overwriting warning
  4. Logs to the LSP console if the user cancels
  5. Proceeds with the operation only on confirmichten
- `uploadOnSave` is **not** prompted — it's an opt-in feature with its own UX.

**Tests:** `server/test/confirm.test.ts` — 7 tests covering confirm/cancel/dismiss,
custom labels, strict-label matching, and the default `Cancel` fallback.

---

## Issue 9 — `protocol: "ftp" | "ftps"` declared, only SFTP implemented

**Severity:** Low (misleading, not exploitable).

**Where:** `server/src/config.ts` `SftpConfig.protocol` type and runtime.

**The fix (A + B):**

**A. Type tightened:**
```ts
protocol?: "sftp";  // was: "sftp" | "ftp" | "ftps" (required)
```

**B. Load-time rejection:**
```ts
if (this.config.protocol !== undefined && this.config.protocol !== "sftp") {
    throw new Error(`Unsupported protocol: "${this.config.protocol}". ...`);
}
```
Fails fast with a clear error if someone tries to set `ftp` or `ftps`.

**Plus:** deleted the misleading `examples/ftp-config.example.json` and
updated the README to remove FTP/FTPS mentions from the user-facing
description, configuration table, and feature comparison.

**Tests:** 5 tests in `config.test.ts` `ConfigManager.loadConfig protocol
validation (issue #9)` suite, covering accept (`sftp`, undefined) and reject
(`ftp`, `ftps`, unknown values).

---

## Issue 10 — `saveConfig()` writes to disk without permission check

**Severity:** Low (dead code with no caller; latent footgun if exposed).

**The fix:** Removed entirely. `rg "saveConfig"` confirmed zero callers, zero
tests, zero documentation references. Any future "save config from UI" work
will be designed fresh with proper UX (likely LSP workspace edits + JSON
schema validation).

---

## Issue 11 — Supply-chain risk via npm `latest` fetch

**Severity:** High. The Rust shim was a thin wrapper that fetched and ran
whatever `zed-sftp-server@latest` was on npm.

**Where:** `src/lib.rs` lines 6–62 (old version).

**The fix (Option A — version pin):**

```rust
// SECURITY: pinned to a specific version to prevent running code from a
// compromised or squatted npm package. Bump this constant and ship a new
// extension release to roll out a new server version.
const PACKAGE_VERSION: &str = "1.0.0";
```

The Rust shim no longer calls `npm_package_latest_version`. It installs
exactly `1.0.0` and verifies the installed version matches after install:

```rust
let post_install_version = zed::npm_package_installed_version(PACKAGE_NAME)?;
if post_install_version.as_deref() != Some(PACKAGE_VERSION) {
    return Err(format!(
        "Installed version '{:?}' does not match pinned version '{}'. \
        Refusing to run unverified code.",
        post_install_version, PACKAGE_VERSION,
    ));
}
```

The fallback path (install fails but a prior install exists) now also verifies
the existing version matches the pin before running.

**Operational change:** Every server-side release now requires a Rust shim
rebuild:
1. Bump `server/package.json` version
2. Bump `PACKAGE_VERSION` in `src/lib.rs` to match
3. `cargo build --target wasm32-wasip1 --release`
4. Ship the new extension release

This is a deliberate trade-off: slightly higher release cost for a hard
guarantee that npm-side compromise can't silently swap the running server code.

**Not yet addressed by this fix:** cryptographic integrity (Option B from the
original summary). The current pin catches version mismatches but not
post-install file tampering. For full defense, the server would need to be
vendored into the extension and verified against an embedded hash.

---

## Files added

```
server/src/host-verifier.ts   — shouldEnforceHostKey, makeHostVerifier (Issue 1)
server/src/path-utils.ts      — expandHome (Issue 3)
server/src/env.ts             — resolveEnv (Issue 5)
server/src/connect-config.ts  — buildConnectConfig (Issue 7 refactor)
server/src/confirm.ts         — confirmOperation (Issue 8)
server/test/                  — full test suite (Issues 1–9)
SECURITY_AUDIT.md             — this document
```

## Files modified

```
src/lib.rs                  — supply-chain pin (Issue 11)
server/src/config.ts        — Issues 2, 4, 5, 9, and JSDoc wiring map (Issue 7)
server/src/sftp-client.ts   — uses buildConnectConfig (Issue 7)
server/src/index.ts         — manual command confirmation prompts (Issue 8)
server/package.json         — added tsx devDep + test scripts
.gitignore                  — added .zed/sftp.json (Issue 5)
README.md                   — Security section, env-var docs, host-key docs,
                             algorithms note, manual command confirmation docs
examples/sftp-config.example.json     — hostKey + modern algorithms
examples/multi-profile.example.json  — hostKey per profile
examples/wordpress-context.example.json — hostKey
```

## Files deleted

```
examples/ftp-config.example.json   — misleading FTPS example (Issue 9)
```

## Test infrastructure

The project previously had no automated tests. The audit added a test suite using
Node's built-in `node:test` runner with `tsx` for TypeScript support — no heavy
test framework needed.

**98 tests across 14 suites, all passing:**

```
# tests 98
# pass 98
# fail 0
```

Test files:
- `server/test/host-verifier.test.ts` — 21 tests (Issues 1, host-key verification)
- `server/test/config.test.ts` — 28 tests (Issues 2, 4, 5, 9)
- `server/test/path-utils.test.ts` — 13 tests (Issue 3)
- `server/test/env.test.ts` — 9 tests (Issue 5)
- `server/test/connect-config.test.ts` — 20 tests (Issue 7)
- `server/test/confirm.test.ts` — 7 tests (Issue 8)

Run with:
```
cd server && npm test
```

Watch mode:
```
cd server && npm run test:watch
```

## What was deliberately not changed (out of scope)

- **`uploadOnSave` confirmation prompts** — adding prompts to the auto-upload
  path would change the core UX of the extension and warrants a separate
  major-version discussion.
- **Vendoring the server (Option B for Issue 11)** — stronger supply-chain
  defense, but larger change (bundles `dist/index.js` in the extension
  package). The version pin is a meaningful 90% solution.
- **`isConnected` flag staleness** (originally noted as Issue 12 in the
  review) — reliability, not security. The connection-error path resets the
  flag; mid-operation drops still leave it stale but the next operation will
  fail and surface a clear error. Worth fixing later.
- **LSP console logs include full local/remote paths** — fine for the user's
  own log; only a concern if logs are shared.
- **JSON Schema for `.zed/sftp.json`** — `$schema` references in examples but
  no actual schema file. Would prevent malformed configs from being a security
  issue. Not implemented.
- **Issue #8's "Option D: debounce saves"** — useful for reliability, not
  security. Not implemented.

## Follow-up recommendations

1. **Run `cargo build` before publishing** — the Rust change in Issue 11
   couldn't be compile-verified in this environment (no `cargo` installed).
   The pre-built `extension.wasm` in the repo root is stale.
2. **Implement `knownHostsPath` properly** — currently logs a warning and
   falls through. Would let users point at an existing `~/.ssh/known_hosts`
   without manually copying fingerprints.
3. **Add JSON Schema for `.zed/sftp.json`** — the `$schema` references in
   examples point to a non-existent schema. Publishing one would catch
   typos and unknown fields at config-load time.
4. **Vendor the server (Issue 11 Option B)** — strongest supply-chain
   defense; current pin is a 90% solution that leaves post-install file
   tampering as a residual risk.
5. **Fix `isConnected` flag staleness** — reliability, not security, but
   would prevent confusing "still connected" messages when the connection
   actually dropped mid-operation.
6. **Consider CI** — currently no CI runs the test suite on push. Adding
   a basic GitHub Actions workflow would catch regressions automatically.