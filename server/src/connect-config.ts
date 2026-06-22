import * as fs from "fs";
import { SftpConfig } from "./config";
import { shouldEnforceHostKey, makeHostVerifier } from "./host-verifier";
import { expandHome } from "./path-utils";

/**
 * Build the options object passed to `ssh2-sftp-client`'s `connect()`.
 *
 * This is the single place where `SftpConfig` fields are translated into
 * ssh2 connection options. Adding a new field to `SftpConfig`? Wire it in
 * here and add a test in `connect-config.test.ts`.
 *
 * Pure-ish: reads the private-key file from disk (a real side effect, since
 * ssh2 expects a Buffer), but does not open the network connection. Warnings
 * are emitted through the optional `log` callback so the caller can route
 * them to the LSP console.
 *
 * Throws on configuration errors (missing private key, missing host key,
 * etc.) so the caller can surface them with context.
 */
export function buildConnectConfig(
	config: SftpConfig,
	log?: (message: string) => void,
): Record<string, unknown> {
	const connectConfig: Record<string, unknown> = {
		host: config.host,
		port: config.port || 22,
		username: config.username,
	};

	// Authentication
	if (config.password) {
		connectConfig.password = config.password;
	} else if (config.privateKeyPath) {
		const keyPath = expandHome(config.privateKeyPath);
		if (!fs.existsSync(keyPath)) {
			throw new Error(
				`Private key not found at ${keyPath} ` +
				`(expanded from privateKeyPath "${config.privateKeyPath}")`,
			);
		}
		connectConfig.privateKey = fs.readFileSync(keyPath);
		if (config.passphrase) {
			connectConfig.passphrase = config.passphrase;
		}
	}

	// Host key verification
	if (shouldEnforceHostKey(config)) {
		throw new Error(
			`Refusing to connect to ${config.host}: host key verification is required but no ` +
			`\`hostKey\` or \`knownHostsPath\` is configured. ` +
			`Get the server's fingerprint with \`ssh-keyscan -t ed25519,rsa,ecdsa ${config.host}\` ` +
			`and add it to your config as \`"hostKey": "SHA256:<base64>"\`, ` +
			`or set \`"verifyHostKey": false\` to disable verification (INSECURE).`,
		);
	}

	if (config.knownHostsPath) {
		// Future: parse known_hosts and pass a verifier that checks against
		// the entries. For now, prefer hostKey if both are set, and warn.
		log?.(
			`knownHostsPath is configured but not yet supported in this build. ` +
			`Falling back to hostKey if set, or refusing the connection.`,
		);
	}

	if (config.hostKey) {
		connectConfig.hostHash = "sha256";
		connectConfig.hostVerifier = makeHostVerifier(config.hostKey);
	} else if (config.verifyHostKey === false) {
		log?.(
			`⚠️  Host key verification is DISABLED for ${config.host}. ` +
			`This connection is vulnerable to MITM attacks.`,
		);
	}

	// Algorithm overrides (issue #7: previously declared but never passed)
	if (config.algorithms) {
		connectConfig.algorithms = config.algorithms;
	}

	// Connection timeout
	if (config.connectTimeout) {
		connectConfig.readyTimeout = config.connectTimeout;
	}

	return connectConfig;
}