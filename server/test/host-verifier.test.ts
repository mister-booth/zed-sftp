import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "crypto";

import {
	makeHostVerifier,
	shouldEnforceHostKey,
} from "../src/host-verifier";

// A deterministic 32-byte SHA256 fingerprint we reuse across cases.
const SAMPLE_HASH_HEX = crypto
	.createHash("sha256")
	.update("test-host-key-material")
	.digest("hex");
const SAMPLE_FINGERPRINT = "SHA256:" + Buffer.from(SAMPLE_HASH_HEX, "hex").toString("base64");
const SAMPLE_UNPADDED_B64 = Buffer.from(SAMPLE_HASH_HEX, "hex")
	.toString("base64")
	.replace(/=+$/, "");
const SAMPLE_FINGERPRINT_UNPADDED = "SHA256:" + SAMPLE_UNPADDED_B64;
const OTHER_HASH_HEX = crypto
	.createHash("sha256")
	.update("a-different-host-key")
	.digest("hex");

describe("makeHostVerifier", () => {
	test("accepts a matching SHA256:<base64> fingerprint (padded)", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify(SAMPLE_HASH_HEX), true);
	});

	test("accepts an unpadded SHA256:<base64> fingerprint (OpenSSH default format)", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT_UNPADDED);
		assert.equal(verify(SAMPLE_HASH_HEX), true);
	});

	test("accepts a matching bare hex SHA256 fingerprint", () => {
		const verify = makeHostVerifier(SAMPLE_HASH_HEX);
		assert.equal(verify(SAMPLE_HASH_HEX), true);
	});

	test("matches case-insensitively", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify(SAMPLE_HASH_HEX.toUpperCase()), true);
	});

	test("strips an incoming 'sha256:' prefix", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify("sha256:" + SAMPLE_HASH_HEX), true);
	});

	test("rejects a different fingerprint", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify(OTHER_HASH_HEX), false);
	});

	test("rejects a hash of the wrong length without throwing", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify("abcd"), false);
		assert.equal(verify(""), false);
	});

	test("returns false (does not throw) for malformed incoming hex", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify("zz" + SAMPLE_HASH_HEX.slice(2)), false);
	});

	test("returns false for undefined/empty input without throwing", () => {
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		assert.equal(verify(""), false);
		assert.equal(verify(undefined as unknown as string), false);
	});

	test("throws on a clearly invalid fingerprint format at construction time", () => {
		assert.throws(
			() => makeHostVerifier("not-a-fingerprint"),
			/Invalid hostKey format/,
		);
	});

	test("throws on a fingerprint with the wrong hash algorithm prefix", () => {
		assert.throws(
			() => makeHostVerifier("MD5:ab:cd:ef:01:23:45:67:89"),
			/Invalid hostKey format/,
		);
	});

	test("throws on odd-length bare hex", () => {
		assert.throws(() => makeHostVerifier("abc"), /Invalid hostKey format/);
	});

	test("the verifier only matches when every byte equals (timing-safe semantics)", () => {
		// Flip one hex char in the middle — must return false.
		const verify = makeHostVerifier(SAMPLE_FINGERPRINT);
		const flipped =
			SAMPLE_HASH_HEX.slice(0, 32) +
			(SAMPLE_HASH_HEX[32] === "0" ? "1" : "0") +
			SAMPLE_HASH_HEX.slice(33);
		assert.equal(verify(flipped), false);
	});
});

describe("shouldEnforceHostKey", () => {
	test("defaults to enforced when nothing is configured", () => {
		assert.equal(shouldEnforceHostKey({}), true);
	});

	test("enforced when verifyHostKey is undefined and no key/known_hosts set", () => {
		assert.equal(
			shouldEnforceHostKey({ verifyHostKey: undefined }),
			true,
		);
	});

	test("enforced when verifyHostKey is explicitly true and nothing else is configured", () => {
		assert.equal(shouldEnforceHostKey({ verifyHostKey: true }), true);
	});

	test("not enforced when hostKey is set", () => {
		assert.equal(
			shouldEnforceHostKey({ hostKey: SAMPLE_FINGERPRINT }),
			false,
		);
	});

	test("not enforced when knownHostsPath is set", () => {
		assert.equal(
			shouldEnforceHostKey({ knownHostsPath: "/home/me/.ssh/known_hosts" }),
			false,
		);
	});

	test("not enforced when verifyHostKey is false (user opt-out)", () => {
		assert.equal(shouldEnforceHostKey({ verifyHostKey: false }), false);
	});

	test("not enforced when verifyHostKey is false even if hostKey is also set", () => {
		assert.equal(
			shouldEnforceHostKey({
				verifyHostKey: false,
				hostKey: SAMPLE_FINGERPRINT,
			}),
			false,
		);
	});

	test("not enforced when both hostKey and knownHostsPath are set", () => {
		assert.equal(
			shouldEnforceHostKey({
				hostKey: SAMPLE_FINGERPRINT,
				knownHostsPath: "/etc/ssh/known_hosts",
			}),
			false,
		);
	});
});