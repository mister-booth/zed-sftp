import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveEnv } from "../src/env";

// Track env vars we touch so we can restore them between tests.
const TOUCHED_VARS = ["SFTP_TEST_VAR", "SFTP_TEST_EMPTY", "SFTP_TEST_UNSET"];

function clearTestVars() {
	for (const v of TOUCHED_VARS) delete process.env[v];
}

describe("resolveEnv", () => {
	test("returns undefined for undefined input", () => {
		assert.equal(resolveEnv(undefined), undefined);
	});

	test("returns empty string for empty input (no expansion)", () => {
		assert.equal(resolveEnv(""), "");
	});

	test("returns the string as-is when it does not start with $", () => {
		assert.equal(resolveEnv("plaintext"), "plaintext");
		assert.equal(resolveEnv("p@ssw0rd!"), "p@ssw0rd!");
	});

	test("returns a bare '$' as-is (not a valid var reference)", () => {
		assert.equal(resolveEnv("$"), "$");
	});

	test("returns the env var value when the string starts with $ and the var is set", () => {
		clearTestVars();
		process.env.SFTP_TEST_VAR = "hunter2";
		try {
			assert.equal(resolveEnv("$SFTP_TEST_VAR"), "hunter2");
		} finally {
			clearTestVars();
		}
	});

	test("preserves the env var's empty-string value (distinct from unset)", () => {
		clearTestVars();
		process.env.SFTP_TEST_EMPTY = "";
		try {
			assert.equal(resolveEnv("$SFTP_TEST_EMPTY"), "");
		} finally {
			clearTestVars();
		}
	});

	test("throws when the referenced env var is unset", () => {
		clearTestVars();
		assert.throws(
			() => resolveEnv("$SFTP_TEST_UNSET"),
			/SFTP_TEST_UNSET.*not set/,
		);
	});

	test("does NOT expand $VAR when the $ is mid-string", () => {
		// "prefix-$VAR" should be treated as a literal value, not expanded.
		clearTestVars();
		process.env.SFTP_TEST_VAR = "should-not-appear";
		try {
			assert.equal(resolveEnv("prefix-$SFTP_TEST_VAR"), "prefix-$SFTP_TEST_VAR");
		} finally {
			clearTestVars();
		}
	});

	test("does NOT expand $$ as an escape (literal '$' prefix)", () => {
		// We don't implement shell-style $$ escape. A literal $ prefix
		// is just treated as a non-reference (since the var name is empty
		// after the first $). This documents the behavior.
		clearTestVars();
		process.env.SFTP_TEST_VAR = "x";
		try {
			assert.equal(resolveEnv("$$"), "$$");
		} finally {
			clearTestVars();
		}
	});
});