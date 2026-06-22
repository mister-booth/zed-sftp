import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";

import { expandHome } from "../src/path-utils";

describe("expandHome", () => {
	test("expands a bare '~' to the user's home directory", () => {
		assert.equal(expandHome("~"), os.homedir());
	});

	test("expands '~/foo' to '<home>/foo'", () => {
		assert.equal(expandHome("~/foo"), path.join(os.homedir(), "foo"));
	});

	test("expands '~/' keeping the trailing separator (path.join semantics)", () => {
		assert.equal(expandHome("~/"), os.homedir() + path.sep);
	});

	test("expands '~<sep>foo' (platform separator)", () => {
		assert.equal(
			expandHome("~" + path.sep + "foo"),
			path.join(os.homedir(), "foo"),
		);
	});

	test("expands '~/.ssh/id_rsa' to the standard SSH key path", () => {
		assert.equal(
			expandHome("~/.ssh/id_rsa"),
			path.join(os.homedir(), ".ssh", "id_rsa"),
		);
	});

	test("does NOT expand a mid-path '~' (the original bug)", () => {
		// The old code did .replace('~', $HOME) which inserted $HOME mid-string.
		const input = "/some/weird/~middle/path";
		assert.equal(expandHome(input), input);
	});

	test("does NOT expand a second '~' in the path", () => {
		// Old code: .replace('~', ...) only touches the first '~'.
		const input = "~/.ssh/~/key";
		const expected = path.join(os.homedir(), ".ssh", "~", "key");
		assert.equal(expandHome(input), expected);
	});

	test("does NOT expand '~user' syntax (unsupported, passed through)", () => {
		const input = "~root/.ssh/id_rsa";
		assert.equal(expandHome(input), input);
	});

	test("does NOT expand '~foo' (no slash after the tilde)", () => {
		// Only '~' alone or '~/' / '~\\' is treated as a home prefix.
		// '~foo' is treated as a literal name and passed through.
		const input = "~foo";
		assert.equal(expandHome(input), input);
	});

	test("leaves absolute paths (no leading '~') untouched", () => {
		const input = path.join(path.sep, "etc", "ssh", "id_rsa");
		assert.equal(expandHome(input), input);
	});

	test("leaves relative paths untouched", () => {
		const input = "keys/id_rsa";
		assert.equal(expandHome(input), input);
	});

	test("leaves an empty string untouched", () => {
		assert.equal(expandHome(""), "");
	});

	test("works even when HOME is unset (uses os.homedir)", () => {
		// os.homedir() doesn't depend on $HOME on Linux/macOS — it reads
		// passwd. So we just verify the function doesn't throw.
		const original = process.env.HOME;
		delete process.env.HOME;
		try {
			assert.equal(expandHome("~"), os.homedir());
			assert.equal(
				expandHome("~/foo"),
				path.join(os.homedir(), "foo"),
			);
		} finally {
			if (original !== undefined) process.env.HOME = original;
		}
	});
});