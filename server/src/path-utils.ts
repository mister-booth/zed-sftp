import * as os from "os";
import * as path from "path";

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
export function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~")) {
		const rest = p.slice(1);
		if (rest === "" || rest.startsWith("/") || rest.startsWith(path.sep)) {
			return path.join(os.homedir(), rest);
		}
	}
	return p;
}