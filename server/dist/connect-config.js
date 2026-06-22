"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConnectConfig = buildConnectConfig;
const fs = __importStar(require("fs"));
const host_verifier_1 = require("./host-verifier");
const path_utils_1 = require("./path-utils");
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
function buildConnectConfig(config, log) {
    const connectConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
    };
    // Authentication
    if (config.password) {
        connectConfig.password = config.password;
    }
    else if (config.privateKeyPath) {
        const keyPath = (0, path_utils_1.expandHome)(config.privateKeyPath);
        if (!fs.existsSync(keyPath)) {
            throw new Error(`Private key not found at ${keyPath} ` +
                `(expanded from privateKeyPath "${config.privateKeyPath}")`);
        }
        connectConfig.privateKey = fs.readFileSync(keyPath);
        if (config.passphrase) {
            connectConfig.passphrase = config.passphrase;
        }
    }
    // Host key verification
    if ((0, host_verifier_1.shouldEnforceHostKey)(config)) {
        throw new Error(`Refusing to connect to ${config.host}: host key verification is required but no ` +
            `\`hostKey\` or \`knownHostsPath\` is configured. ` +
            `Get the server's fingerprint with \`ssh-keyscan -t ed25519,rsa,ecdsa ${config.host}\` ` +
            `and add it to your config as \`"hostKey": "SHA256:<base64>"\`, ` +
            `or set \`"verifyHostKey": false\` to disable verification (INSECURE).`);
    }
    if (config.knownHostsPath) {
        // Future: parse known_hosts and pass a verifier that checks against
        // the entries. For now, prefer hostKey if both are set, and warn.
        log?.(`knownHostsPath is configured but not yet supported in this build. ` +
            `Falling back to hostKey if set, or refusing the connection.`);
    }
    if (config.hostKey) {
        connectConfig.hostHash = "sha256";
        connectConfig.hostVerifier = (0, host_verifier_1.makeHostVerifier)(config.hostKey);
    }
    else if (config.verifyHostKey === false) {
        log?.(`⚠️  Host key verification is DISABLED for ${config.host}. ` +
            `This connection is vulnerable to MITM attacks.`);
    }
    // Algorithm overrides (issue #7: previously declared but never passed)
    if (config.algorithms) {
        connectConfig.algorithms = config.algorithms;
    }
    // Connection timeout
    if (config.connectTimeout) {
        connectConfig.readyTimeout = config.connectTimeout;
    }
    return connectConfig;
}
//# sourceMappingURL=connect-config.js.map