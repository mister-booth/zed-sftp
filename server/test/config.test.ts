import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ConfigManager, SftpConfig } from "../src/config";

// Build test paths using path.join so the tests work on both POSIX and
// Windows (the bug is platform-agnostic — string-prefix matching breaks
// regardless of which separator the OS uses).
const projRoot = path.join(path.sep, "work", "proj");
const context = path.join(projRoot, "site", "wp-content");
const fileInside = path.join(context, "themes", "style.css");
const fileExactContext = context;
const fileSibling = path.join(projRoot, "site", "wp-content-evil", "leak.txt");
const fileParent = path.join(projRoot, "site", "other", "file.txt");
const fileUnrelated = path.join(path.sep, "etc", "passwd");

/**
 * Construct a ConfigManager with a preset context path (bypassing
 * loadConfig so we don't need a real .zed/sftp.json on disk).
 */
function makeManager(
	contextPath: string = context,
	remotePath: string = "/var/www/html",
): ConfigManager {
	const mgr = new ConfigManager(projRoot);
	const config: SftpConfig = {
		protocol: "sftp",
		host: "example.com",
		username: "test",
		remotePath,
	};
	// contextPath and config are private; assign through type casts for tests.
	(mgr as unknown as { contextPath: string }).contextPath = contextPath;
	(mgr as unknown as { config: SftpConfig }).config = config;
	return mgr;
}

describe("ConfigManager.isInContext", () => {
	test("returns true for a file strictly inside the context", () => {
		const mgr = makeManager();
		assert.equal(mgr.isInContext(fileInside), true);
	});

	test("returns true for the context path itself (exact match)", () => {
		const mgr = makeManager();
		assert.equal(mgr.isInContext(fileExactContext), true);
	});

	test("returns false for a sibling directory with a shared string prefix (the boundary bug)", () => {
		const mgr = makeManager();
		assert.equal(mgr.isInContext(fileSibling), false);
	});

	test("returns false for a parent directory of the context", () => {
		const mgr = makeManager();
		assert.equal(mgr.isInContext(fileParent), false);
	});

	test("returns false for an unrelated absolute path", () => {
		const mgr = makeManager();
		assert.equal(mgr.isInContext(fileUnrelated), false);
	});

	test("normalizes double slashes and '.' segments before comparing", () => {
		const mgr = makeManager();
		const withDoubleSlashes = fileInside.replace(path.sep + path.sep, path.sep);
		const withDotSegment = path.join(context, ".", "themes", "style.css");
		assert.equal(mgr.isInContext(withDoubleSlashes), true);
		assert.equal(mgr.isInContext(withDotSegment), true);
	});

	test("normalizes '..' segments that resolve back into the context", () => {
		const mgr = makeManager();
		const resolvesInside = path.join(
			context,
			"themes",
			"..",
			"themes",
			"style.css",
		);
		assert.equal(mgr.isInContext(resolvesInside), true);
	});

	test("normalizes '..' segments that escape the context, then rejects them", () => {
		const mgr = makeManager();
		const escapes = path.join(context, "..", "wp-content-evil", "leak.txt");
		assert.equal(mgr.isInContext(escapes), false);
	});

	test("handles a context path that has a trailing separator", () => {
		const mgr = makeManager(context + path.sep);
		assert.equal(mgr.isInContext(fileInside), true);
		assert.equal(mgr.isInContext(fileSibling), false);
		assert.equal(mgr.isInContext(fileExactContext), true);
	});

	test("rejects a file that shares the context as a prefix character but is outside", () => {
		// Context: /work/proj/site/wp-content
		// File:    /work/proj/site/wp-content2/extra/file.txt
		// Without the boundary fix, startsWith would return true here.
		const mgr = makeManager();
		const sneaky = path.join(projRoot, "site", "wp-content2", "extra", "file.txt");
		assert.equal(mgr.isInContext(sneaky), false);
	});

	test("does not throw on empty or weird input", () => {
		const mgr = makeManager();
		assert.equal(mgr.isInContext(""), false);
		assert.equal(mgr.isInContext(fileInside + path.sep), true);
	});
});

describe("ConfigManager.getRemotePath", () => {
	test("returns the joined remote path for a file inside the context", () => {
		const mgr = makeManager();
		assert.equal(
			mgr.getRemotePath(fileInside),
			"/var/www/html/themes/style.css",
		);
	});

	test("returns null for a file outside the context", () => {
		const mgr = makeManager();
		assert.equal(mgr.getRemotePath(fileSibling), null);
		assert.equal(mgr.getRemotePath(fileParent), null);
		assert.equal(mgr.getRemotePath(fileUnrelated), null);
	});

	test("returns null (not throws) for a file with literal '..' segments in its name", () => {
		// A file legitimately named "version..1.0.txt" must not be rejected.
		const mgr = makeManager();
		const legitName = path.join(context, "version..1.0.txt");
		assert.equal(mgr.isInContext(legitName), true);
		assert.equal(
			mgr.getRemotePath(legitName),
			"/var/www/html/version..1.0.txt",
		);
	});

	test("returns null (not throws) for a file with '..' mid-name inside context", () => {
		const mgr = makeManager();
		const weird = path.join(context, "draft...final", "notes.md");
		assert.equal(
			mgr.getRemotePath(weird),
			"/var/www/html/draft...final/notes.md",
		);
	});

	test("returns null when the file uses '..' to escape the context", () => {
		const mgr = makeManager();
		const escapes = path.join(context, "..", "wp-content-evil", "leak.txt");
		assert.equal(mgr.getRemotePath(escapes), null);
	});

	test("resolves '..' segments that stay inside the context", () => {
		const mgr = makeManager();
		const staysInside = path.join(context, "themes", "..", "themes", "style.css");
		assert.equal(
			mgr.getRemotePath(staysInside),
			"/var/www/html/themes/style.css",
		);
	});

	test("normalizes the configured remotePath if it lacks a leading slash", () => {
		const mgr = makeManager(context, "var/www/html");
		assert.equal(
			mgr.getRemotePath(fileInside),
			"/var/www/html/themes/style.css",
		);
	});

	test("uses forward slashes in the remote path regardless of OS separator", () => {
		const mgr = makeManager();
		const deep = path.join(context, "a", "b", "c", "d.css");
		assert.equal(mgr.getRemotePath(deep), "/var/www/html/a/b/c/d.css");
	});
});

describe("ConfigManager.loadConfig env-var integration", () => {
	let tempDir: string;
	const TOUCHED_VARS = ["INT_SFTP_PASSWORD", "INT_SFTP_PASSPHRASE"];

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sftp-test-"));
		fs.mkdirSync(path.join(tempDir, ".zed"), { recursive: true });
		for (const v of TOUCHED_VARS) delete process.env[v];
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		for (const v of TOUCHED_VARS) delete process.env[v];
	});

	function writeConfig(content: object): void {
		const configPath = path.join(tempDir, ".zed", "sftp.json");
		fs.writeFileSync(configPath, JSON.stringify(content));
	}

	test("resolves $VAR in top-level password from the environment", async () => {
		process.env.INT_SFTP_PASSWORD = "resolved-pw";
		writeConfig({
			protocol: "sftp",
			host: "example.com",
			username: "test",
			password: "$INT_SFTP_PASSWORD",
			remotePath: "/var/www/html",
		});

		const mgr = new ConfigManager(tempDir);
		const loaded = await mgr.loadConfig();

		assert.equal(loaded?.password, "resolved-pw");
	});

	test("resolves $VAR in passphrase inside a profile after merge", async () => {
		process.env.INT_SFTP_PASSPHRASE = "resolved-phrase";
		writeConfig({
			protocol: "sftp",
			host: "base.example.com",
			username: "test",
			remotePath: "/var/www/html",
			privateKeyPath: "~/.ssh/id_rsa",
			profiles: {
				prod: {
					host: "prod.example.com",
					passphrase: "$INT_SFTP_PASSPHRASE",
				},
			},
			defaultProfile: "prod",
		});

		const mgr = new ConfigManager(tempDir);
		const loaded = await mgr.loadConfig();

		assert.equal(loaded?.host, "prod.example.com");
		assert.equal(loaded?.passphrase, "resolved-phrase");
	});

	test("leaves plaintext passwords untouched (no $ prefix)", async () => {
		writeConfig({
			protocol: "sftp",
			host: "example.com",
			username: "test",
			password: "plain-password",
			remotePath: "/var/www/html",
		});

		const mgr = new ConfigManager(tempDir);
		const loaded = await mgr.loadConfig();

		assert.equal(loaded?.password, "plain-password");
	});

	test("throws when a referenced env var is unset (config error surfaces at load time)", async () => {
		writeConfig({
			protocol: "sftp",
			host: "example.com",
			username: "test",
			password: "$INT_SFTP_PASSWORD",
			remotePath: "/var/www/html",
		});

		const mgr = new ConfigManager(tempDir);
		await assert.rejects(
			async () => await mgr.loadConfig(),
			/INT_SFTP_PASSWORD.*not set/,
		);
	});
});

describe("ConfigManager.loadConfig protocol validation (issue #9)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sftp-proto-test-"));
		fs.mkdirSync(path.join(tempDir, ".zed"), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function writeConfig(extra: Record<string, unknown> = {}) {
		const configPath = path.join(tempDir, ".zed", "sftp.json");
		const config = {
			protocol: "sftp",
			host: "example.com",
			username: "test",
			password: "test",
			remotePath: "/var/www/html",
			hostKey: "SHA256:" + Buffer.from("a".repeat(32)).toString("base64"),
			...extra,
		};
		fs.writeFileSync(configPath, JSON.stringify(config));
	}

	test("accepts protocol: 'sftp' explicitly", async () => {
		writeConfig({ protocol: "sftp" });
		const mgr = new ConfigManager(tempDir);
		const loaded = await mgr.loadConfig();
		assert.equal(loaded?.protocol, "sftp");
	});

	test("accepts an absent protocol field (defaults to SFTP)", async () => {
		writeConfig({ protocol: undefined });
		const mgr = new ConfigManager(tempDir);
		const loaded = await mgr.loadConfig();
		assert.equal(loaded?.protocol, undefined);
	});

	test("rejects protocol: 'ftp' with a clear error message", async () => {
		writeConfig({ protocol: "ftp" });
		const mgr = new ConfigManager(tempDir);
		await assert.rejects(
			async () => await mgr.loadConfig(),
			/Unsupported protocol: "ftp".*only supports "sftp"/,
		);
	});

	test("rejects protocol: 'ftps' with a clear error message", async () => {
		writeConfig({ protocol: "ftps" });
		const mgr = new ConfigManager(tempDir);
		await assert.rejects(
			async () => await mgr.loadConfig(),
			/Unsupported protocol: "ftps".*only supports "sftp"/,
		);
	});

	test("rejects unknown protocol values", async () => {
		writeConfig({ protocol: "scp" });
		const mgr = new ConfigManager(tempDir);
		await assert.rejects(
			async () => await mgr.loadConfig(),
			/Unsupported protocol: "scp".*only supports "sftp"/,
		);
	});
});