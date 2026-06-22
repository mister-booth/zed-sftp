/**
 * Expand a leading `~` or `~/` in a local filesystem path to the current
 * user's home directory.
 *
 * Unlike `String.prototype.replace("~", ...)`, this only matches `~` at
 * the start of the path, so mid-path occurrences (e.g. `/etc/~foo`) are
 * left untouched. `~user/...` syntax is not supported and is passed
 * through unchanged.
 *
 * Uses `os.homedir()` rather than `$HOME` so it works on Windows and in
 * environments where the `HOME` env var is not set.
 */
export declare function expandHome(p: string): string;
//# sourceMappingURL=path-utils.d.ts.map