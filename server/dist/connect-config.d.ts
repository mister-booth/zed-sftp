import { SftpConfig } from "./config";
/**
 * Build the options object passed to `ssh2-sftp-client`'s `connect()`.
 *
 * This is the single place where `SftpConfig` fields are translated into
 * ssh2 connection options. Adding a new field to `SftpConfig`? Wire it in
 * here and add a test in `connect-config.test.ts`.
 *
 * Pure-ish: reads the private-key file from disk (a real side effect, since
 * ssh2 expects a Buffer), but does not open the network connection. Warnings
 * are emitted through the optional `log` callback so the caller can route
 * them to the LSP console.
 *
 * Throws on configuration errors (missing private key, missing host key,
 * etc.) so the caller can surface them with context.
 */
export declare function buildConnectConfig(config: SftpConfig, log?: (message: string) => void): Record<string, unknown>;
//# sourceMappingURL=connect-config.d.ts.map