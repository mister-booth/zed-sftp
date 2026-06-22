import * as crypto from "crypto";

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
export function shouldEnforceHostKey(opts: HostVerificationOptions): boolean {
	const verifyHostKey = opts.verifyHostKey !== false;
	const hasHostKey = !!opts.hostKey;
	const hasKnownHosts = !!opts.knownHostsPath;
	return verifyHostKey && !hasHostKey && !hasKnownHosts;
}

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
export function makeHostVerifier(expectedFingerprint: string): (keyHashHex: string) => boolean {
	const trimmed = expectedFingerprint.trim();
	let expectedHex: string;
	if (/^SHA256:[A-Za-z0-9+/=]+$/.test(trimmed)) {
		const b64 = trimmed.slice("SHA256:".length);
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		expectedHex = Buffer.from(padded, "base64").toString("hex");
	} else if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0) {
		expectedHex = trimmed.toLowerCase();
	} else {
		throw new Error(
			`Invalid hostKey format: expected "SHA256:<base64>" (as printed by \`ssh-keygen -lf\`) or a hex SHA256 string, got: ${expectedFingerprint}`,
		);
	}

	return (keyHashHex: string): boolean => {
		const provided = (keyHashHex || "").toLowerCase().replace(/^sha256:/, "");
		if (provided.length !== expectedHex.length) return false;
		try {
			return crypto.timingSafeEqual(
				Buffer.from(provided, "hex"),
				Buffer.from(expectedHex, "hex"),
			);
		} catch {
			return false;
		}
	};
}