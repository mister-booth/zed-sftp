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
    context?: string;
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
export declare class ConfigManager {
    private workspaceFolder;
    private config;
    private ignorePatterns;
    private contextPath;
    constructor(workspaceFolder: string);
    loadConfig(): Promise<SftpConfig | null>;
    shouldIgnore(filePath: string): boolean;
    /**
     * Check if a file is within the context path.
     *
     * Uses a separator-aware boundary check so that sibling directories
     * which share a string prefix (e.g. `/work/site/wp-content-evil`)
     * are NOT considered to be inside `/work/site/wp-content`.
     */
    isInContext(filePath: string): boolean;
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
    getRemotePath(localFilePath: string): string | null;
    getConfig(): SftpConfig | null;
    getContextPath(): string;
    reloadConfig(): Promise<SftpConfig | null>;
}
//# sourceMappingURL=config.d.ts.map