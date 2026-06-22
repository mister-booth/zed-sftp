/**
 * Resolve a config value that may reference an environment variable.
 *
 * Syntax: a string starting with `$` followed by a valid env-var name is
 * replaced with the value of that variable. For example, `"$SFTP_PASSWORD"`
 * is replaced with `process.env.SFTP_PASSWORD`.
 *
 * A valid env-var name starts with a letter or underscore and contains only
 * letters, digits, and underscores. Anything that doesn't fit that pattern
 * (a bare `$`, `"$$"`, `"$1foo"`, `"$foo.bar"`, mid-string `$`, etc.) is
 * returned unchanged — we don't try to be clever with escaping.
 *
 * Throws if the referenced env var is not set, to surface config errors at
 * load time rather than at first use.
 */
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolveEnv(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value === "") return "";
	if (!value.startsWith("$")) return value;

	const varName = value.slice(1);
	if (!ENV_VAR_NAME.test(varName)) return value; // not a valid env var reference

	const resolved = process.env[varName];
	if (resolved === undefined) {
		throw new Error(
			`Environment variable $${varName} is not set (required by SFTP config). ` +
			`Set it before launching the editor, e.g. \`${varName}=... zed\`.`,
		);
	}
	return resolved;
}