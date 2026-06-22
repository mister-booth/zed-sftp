import * as fs from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import { resolveEnv } from "./env";

/**
 * SFTP / FTP / FTPS connection configuration.
 *
 * Fields consumed by ssh2 (passed via `buildConnectConfig`):
 *   host, port, username, password, privateKeyPath, passphrase,
 *   hostKey, knownHostsPath, verifyHostKey, algorithms, connectTimeout
 *
 * Fields NOT consumed by ssh2 (used elsewhere in the extension):
 *   name, protocol, remotePath, localPath, context, uploadOnSave,
 *   downloadOnOpen, ignore, concurrency, keepalive, interactiveAuth,
 *   watcher, profiles, defaultProfile
 *
 * If you add a field here that should be sent to ssh2, wire it in
 * `connect-config.ts` and add a test in `connect-config.test.ts`.
 */
export interface SftpConfig {
	name?: string;
	/**
	 * Connection protocol. Only `"sftp"` is implemented; the field is
	 * optional and defaults to SFTP. Setting `"ftp"` or `"ftps"` causes
	 * config load to fail with a clear error.
	 */
	protocol?: "sftp";
	host: string;
	port?: number;
	username: string;
	password?: string;
	privateKeyPath?: string;
	passphrase?: string;
	remotePath: string;
	localPath?: string;
	context?: string; // Local subdirectory to use as root (e.g., "site/wp-content/")
	uploadOnSave?: boolean;
	downloadOnOpen?: boolean;
	/**
	 * Prompt for confirmation before each manual upload/download/sync.
	 * Defaults to `true`. Set to `false` to skip the confirmation dialog.
	 * Note: this only affects commands invoked from the command palette;
	 * `uploadOnSave` does not prompt.
	 */
	confirmOperations?: boolean;
	ignore?: string[];
	concurrency?: number;
	connectTimeout?: number;
	keepalive?: number;
	interactiveAuth?: boolean;
	algorithms?: {
		kex?: string[];
		cipher?: string[];
		serverHostKey?: string[];
		hmac?: string[];
	};
	/**
	 * SHA256 fingerprint of the expected server host key, as printed by
	 * `ssh-keygen -lf`. Example: "SHA256:pE4q7Y/...base64...".
	 * Required unless `knownHostsPath` is set or `verifyHostKey` is `false`.
	 */
	hostKey?: string;
	/**
	 * Path to an OpenSSH-style known_hosts file. If set, takes precedence
	 * over `hostKey`.
	 */
	knownHostsPath?: string;
	/**
	 * Set to `false` to explicitly disable host key verification (INSECURE).
	 * Defaults to `true`. When `true`, either `hostKey` or `knownHostsPath`
	 * must be configured.
	 */
	verifyHostKey?: boolean;
	watcher?: {
		files?: string;
		autoUpload?: boolean;
		autoDelete?: boolean;
	};
	profiles?: {
		[key: string]: Partial<SftpConfig>;
	};
	defaultProfile?: string;
}

export class ConfigManager {
	private workspaceFolder: string;
	private config: SftpConfig | null = null;
	private ignorePatterns: string[] = [];
	private contextPath: string = ""; // Resolved context path

	constructor(workspaceFolder: string) {
		this.workspaceFolder = workspaceFolder;
	}

	async loadConfig(): Promise<SftpConfig | null> {
		// Try .zed/sftp.json first
		let configPath = path.join(this.workspaceFolder, ".zed", "sftp.json");

		if (!fs.existsSync(configPath)) {
			// Fall back to .vscode/sftp.json for compatibility
			configPath = path.join(this.workspaceFolder, ".vscode", "sftp.json");
		}

		if (!fs.existsSync(configPath)) {
			// Try root level sftp.json
			configPath = path.join(this.workspaceFolder, "sftp.json");
		}

		if (!fs.existsSync(configPath)) {
			return null;
		}

		try {
			const configContent = fs.readFileSync(configPath, "utf-8");
			this.config = JSON.parse(configContent);

			// Validate required fields
			if (!this.config) {
				throw new Error("Config is empty");
			}

			if (
				this.config.protocol !== undefined &&
				this.config.protocol !== "sftp"
			) {
				throw new Error(
					`Unsupported protocol: "${this.config.protocol}". ` +
					`This build only supports "sftp". ` +
					`FTP and FTPS are not implemented; remove the "protocol" field ` +
					`(or set it to "sftp") to use SFTP.`,
				);
			}

			if (!this.config.host) {
				throw new Error("Missing required field: host");
			}

			if (!this.config.username) {
				throw new Error("Missing required field: username");
			}

			if (!this.config.remotePath) {
				throw new Error("Missing required field: remotePath");
			}

			if (!this.config.password && !this.config.privateKeyPath) {
				throw new Error("Either password or privateKeyPath must be provided");
			}

			if (this.config) {
				// Set default local path
				if (!this.config.localPath) {
					this.config.localPath = this.workspaceFolder;
				}

				// Handle context path (local subdirectory to use as root)
				if (this.config.context) {
					// Normalize context path (remove leading/trailing slashes)
					let context = this.config.context.replace(/^\/+|\/+$/g, "");
					this.contextPath = path.join(this.workspaceFolder, context);
				} else {
					this.contextPath = this.workspaceFolder;
				}

				// Load ignore patterns
				this.ignorePatterns = this.config.ignore || [];

				// Add default ignore patterns
				if (!this.ignorePatterns.includes(".git")) {
					this.ignorePatterns.push(".git");
				}
				if (!this.ignorePatterns.includes("node_modules")) {
					this.ignorePatterns.push("node_modules");
				}

				// Handle profiles
				if (this.config.profiles && this.config.defaultProfile) {
					const profile = this.config.profiles[this.config.defaultProfile];
					if (profile) {
						this.config = { ...this.config, ...profile };
					}
				}

				// Resolve env-var references in credential fields. Run AFTER
				// profile merge so profiles can also use $VAR syntax.
				this.config.password = resolveEnv(this.config.password);
				this.config.passphrase = resolveEnv(this.config.passphrase);
			}

			return this.config;
		} catch (error) {
			throw new Error(`Failed to parse SFTP config: ${error}`);
		}
	}

	shouldIgnore(filePath: string): boolean {
		const relativePath = path.relative(this.workspaceFolder, filePath);

		for (const pattern of this.ignorePatterns) {
			if (minimatch(relativePath, pattern, { dot: true })) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if a file is within the context path.
	 *
	 * Uses a separator-aware boundary check so that sibling directories
	 * which share a string prefix (e.g. `/work/site/wp-content-evil`)
	 * are NOT considered to be inside `/work/site/wp-content`.
	 */
	isInContext(filePath: string): boolean {
		const normalized = path.normalize(filePath);
		let contextNormalized = path.normalize(this.contextPath);

		// Strip a single trailing separator so we can safely append
		// `path.sep` when forming the boundary. Preserve the filesystem
		// root (`/` on POSIX, `C:\` on Windows) as its own boundary.
		if (
			contextNormalized.length > 1 &&
			contextNormalized.endsWith(path.sep)
		) {
			contextNormalized = contextNormalized.slice(0, -path.sep.length);
		}

		if (normalized === contextNormalized) {
			return true;
		}

		const boundary = contextNormalized + path.sep;
		return (
			normalized.length > boundary.length &&
			normalized.startsWith(boundary)
		);
	}

	/**
	 * Get the remote path for a local file, respecting the context setting.
	 *
	 * Security model: the only authoritative check is `isInContext()` above,
	 * which ensures the file lives strictly under the configured context
	 * directory. `path.relative()` then resolves any `..` segments in the
	 * input before they're joined to `remotePath`, so traversal segments
	 * cannot survive to the output. We deliberately do NOT string-scan for
	 * `".."` — a file named `version..1.0.txt` is legitimate and should
	 * upload fine.
	 */
	getRemotePath(localFilePath: string): string | null {
		if (!this.config) {
			return null;
		}

		if (!this.isInContext(localFilePath)) {
			return null;
		}

		const relativePath = path.relative(this.contextPath, localFilePath);

		// Normalize remote path (ensure it starts with /)
		let remotePath = this.config.remotePath;
		if (!remotePath.startsWith("/")) {
			remotePath = "/" + remotePath;
		}

		return path.posix.join(
			remotePath,
			relativePath.split(path.sep).join("/"),
		);
	}

	getConfig(): SftpConfig | null {
		return this.config;
	}

	getContextPath(): string {
		return this.contextPath;
	}

	async reloadConfig(): Promise<SftpConfig | null> {
		return this.loadConfig();
	}
}
