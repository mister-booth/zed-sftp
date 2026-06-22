import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { SftpConfig } from "../src/config";
import { buildConnectConfig } from "../src/connect-config";

// A valid-looking SHA256 fingerprint for tests that need host verification
// enabled. The actual bytes don't matter — we just need it to parse.
const HOST_KEY = "SHA256:" + Buffer.from("a".repeat(32)).toString("base64");

/**
 * Build a minimal valid config for tests, then let each test mutate it.
 */
function baseConfig(overrides: Partial<SftpConfig> = {}): SftpConfig {
	return {
		protocol: "sftp",
		host: "example.com",
		username: "test",
		password: "hunter2",
		remotePath: "/var/www/html",
		hostKey: HOST_KEY,
		...overrides,
	};
}

describe("buildConnectConfig — base connection fields", () => {
	test("includes host, port (default 22), and username", () => {
		const config = baseConfig();
		const result = buildConnectConfig(config);
		assert.equal(result.host, "example.com");
		assert.equal(result.port, 22);
		assert.equal(result.username, "test");
	});

	test("uses a configured port when provided", () => {
		const result = buildConnectConfig(baseConfig({ port: 2222 }));
		assert.equal(result.port, 2222);
	});

	test("includes password when configured", () => {
		const result = buildConnectConfig(baseConfig({ password: "secret" }));
		assert.equal(result.password, "secret");
	});
});

describe("buildConnectConfig — private-key auth", () => {
	let tempDir: string;
	let keyPath: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sftp-test-"));
		keyPath = path.join(tempDir, "test_key");
		fs.writeFileSync(keyPath, "fake-key-bytes");
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("reads the private key file when privateKeyPath is set", () => {
		const result = buildConnectConfig(
			baseConfig({
				password: undefined,
				privateKeyPath: keyPath,
			}),
		);
		assert.ok(Buffer.isBuffer(result.privateKey));
		assert.equal((result.privateKey as Buffer).toString(), "fake-key-bytes");
		assert.equal(result.password, undefined);
	});

	test("includes passphrase when set alongside the key", () => {
		const result = buildConnectConfig(
			baseConfig({
				password: undefined,
				privateKeyPath: keyPath,
				passphrase: "$KEY_PASSPHRASE",
			}),
		);
		assert.equal(result.passphrase, "$KEY_PASSPHRASE");
	});

	test("expands ~ in privateKeyPath before reading", () => {
		assert.throws(
			() =>
				buildConnectConfig(
					baseConfig({
						password: undefined,
						privateKeyPath: "~/nonexistent-test-key-12345",
					}),
				),
			/Private key not found at .*nonexistent-test-key-12345/,
		);
	});

	test("throws a clear error when the private key file does not exist", () => {
		assert.throws(
			() =>
				buildConnectConfig(
					baseConfig({
						password: undefined,
						privateKeyPath: "/no/such/key/here",
					}),
				),
			/Private key not found at \/no\/such\/key\/here/,
		);
	});
});

describe("buildConnectConfig — host key verification", () => {
	test("sets hostHash and hostVerifier when hostKey is configured", () => {
		const result = buildConnectConfig(baseConfig());
		assert.equal(result.hostHash, "sha256");
		assert.equal(typeof result.hostVerifier, "function");
	});

	test("the hostVerifier accepts the matching fingerprint and rejects others", () => {
		const expectedHashHex = "61".repeat(32); // 32 bytes of 0x61 ('a')
		const fingerprint =
			"SHA256:" + Buffer.from(expectedHashHex, "hex").toString("base64");
		const result = buildConnectConfig(
			baseConfig({ hostKey: fingerprint }),
		);
		const verifier = result.hostVerifier as (h: string) => boolean;
		assert.equal(verifier(expectedHashHex), true);
		assert.equal(verifier("00".repeat(32)), false);
	});

	test("throws when verification is required but no hostKey / knownHostsPath is set", () => {
		assert.throws(
			() =>
				buildConnectConfig(
					baseConfig({ hostKey: undefined, knownHostsPath: undefined }),
				),
			/Refusing to connect to example\.com: host key verification is required/,
		);
	});

	test("does not throw when verifyHostKey is explicitly false (opt-out)", () => {
		const warnings: string[] = [];
		const result = buildConnectConfig(
			baseConfig({ hostKey: undefined, verifyHostKey: false }),
			(msg) => warnings.push(msg),
		);
		assert.equal(result.hostHash, undefined);
		assert.equal(result.hostVerifier, undefined);
		assert.ok(
			warnings.some((w) => /Host key verification is DISABLED/.test(w)),
			"expected a 'verification disabled' warning",
		);
	});

	test("warns (but does not throw) when knownHostsPath is set without hostKey", () => {
		const warnings: string[] = [];
		buildConnectConfig(
			baseConfig({ hostKey: undefined, knownHostsPath: "/etc/known_hosts", verifyHostKey: false }),
			(msg) => warnings.push(msg),
		);
		assert.ok(
			warnings.some((w) => /knownHostsPath.*not yet supported/.test(w)),
			"expected a knownHostsPath not-supported warning",
		);
	});
});

describe("buildConnectConfig — algorithms (issue #7 regression)", () => {
	test("wires the algorithms config through to ssh2 when set", () => {
		const algorithms = {
			kex: ["curve25519-sha256", "ecdh-sha2-nistp521"],
			cipher: ["chacha20-poly1305@openssh.com", "aes256-gcm@openssh.com"],
			serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp521"],
			hmac: ["hmac-sha2-512-etm@openssh.com", "hmac-sha2-256-etm@openssh.com"],
		};
		const result = buildConnectConfig(baseConfig({ algorithms }));
		assert.deepEqual(result.algorithms, algorithms);
	});

	test("wires a partial algorithms config (e.g. only cipher)", () => {
		const algorithms = { cipher: ["aes256-gcm@openssh.com"] };
		const result = buildConnectConfig(baseConfig({ algorithms }));
		assert.deepEqual(result.algorithms, algorithms);
	});

	test("omits algorithms when not set (ssh2 uses its defaults)", () => {
		const result = buildConnectConfig(baseConfig({ algorithms: undefined }));
		assert.equal(result.algorithms, undefined);
	});

	test("does not silently drop the field when set to an empty object", () => {
		// Even an empty {} is an intentional user choice and must be passed through.
		const result = buildConnectConfig(baseConfig({ algorithms: {} }));
		assert.deepEqual(result.algorithms, {});
	});
});

describe("buildConnectConfig — timeout", () => {
	test("maps connectTimeout to ssh2's readyTimeout", () => {
		const result = buildConnectConfig(baseConfig({ connectTimeout: 5000 }));
		assert.equal(result.readyTimeout, 5000);
	});

	test("omits readyTimeout when connectTimeout is not set", () => {
		const result = buildConnectConfig(baseConfig({ connectTimeout: undefined }));
		assert.equal(result.readyTimeout, undefined);
	});
});

describe("buildConnectConfig — log callback", () => {
	test("does not throw when no log callback is provided", () => {
		// knownHostsPath without log should not crash.
		assert.doesNotThrow(() =>
			buildConnectConfig(
				baseConfig({
					hostKey: undefined,
					knownHostsPath: "/x",
					verifyHostKey: false,
				}),
			),
		);
	});

	test("routes warning messages to the provided log callback", () => {
		const seen: string[] = [];
		buildConnectConfig(
			baseConfig({
				hostKey: undefined,
				knownHostsPath: "/x",
				verifyHostKey: false,
			}),
			(msg) => seen.push(msg),
		);
		assert.ok(seen.length >= 2, "expected at least two warnings");
		assert.ok(seen.some((m) => /knownHostsPath/.test(m)));
		assert.ok(seen.some((m) => /DISABLED/.test(m)));
	});
});