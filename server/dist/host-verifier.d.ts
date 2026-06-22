/**
 * Options relevant to SSH host-key verification, extracted from SftpConfig.
 */
export interface HostVerificationOptions {
    hostKey?: string;
    knownHostsPath?: string;
    verifyHostKey?: boolean;
}
/**
 * Decide whether the connection must be refused because no host-key
 * verification method is configured.
 *
 * Returns `true` when the caller should refuse to connect (verification is
 * required by policy and no fingerprint or known_hosts file has been
 * provided). Returns `false` when verification can proceed — either because
 * it has been explicitly disabled, or because some form of verification has
 * been configured.
 */
export declare function shouldEnforceHostKey(opts: HostVerificationOptions): boolean;
/**
 * Build a `hostVerifier` callback compatible with ssh2 / ssh2-sftp-client.
 *
 * When `hostHash: 'sha256'` is set on the connect config, ssh2 calls the
 * verifier with a lower-case hex SHA256 of the server's host-key blob. This
 * function returns a verifier that compares that value against the
 * fingerprint configured by the user.
 *
 * Accepts the OpenSSH `SHA256:<base64>` format printed by `ssh-keygen -lf`,
 * as well as bare hex SHA256 (with even length). Comparison uses
 * `crypto.timingSafeEqual` and pre-checks lengths to avoid throwing on a
 * mismatch.
 */
export declare function makeHostVerifier(expectedFingerprint: string): (keyHashHex: string) => boolean;
//# sourceMappingURL=host-verifier.d.ts.map