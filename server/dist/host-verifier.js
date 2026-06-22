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
exports.shouldEnforceHostKey = shouldEnforceHostKey;
exports.makeHostVerifier = makeHostVerifier;
const crypto = __importStar(require("crypto"));
/**
 * Decide whether the connection must be refused because no host-key
 * verification method is configured.
 *
 * Returns `true` when the caller should refuse to connect (verification is
 * required by policy and no fingerprint or known_hosts file has been
 * provided). Returns `false` when verification can proceed — either because
 * it has been explicitly disabled, or because some form of verification has
 * been configured.
 */
function shouldEnforceHostKey(opts) {
    const verifyHostKey = opts.verifyHostKey !== false;
    const hasHostKey = !!opts.hostKey;
    const hasKnownHosts = !!opts.knownHostsPath;
    return verifyHostKey && !hasHostKey && !hasKnownHosts;
}
/**
 * Build a `hostVerifier` callback compatible with ssh2 / ssh2-sftp-client.
 *
 * When `hostHash: 'sha256'` is set on the connect config, ssh2 calls the
 * verifier with a lower-case hex SHA256 of the server's host-key blob. This
 * function returns a verifier that compares that value against the
 * fingerprint configured by the user.
 *
 * Accepts the OpenSSH `SHA256:<base64>` format printed by `ssh-keygen -lf`,
 * as well as bare hex SHA256 (with even length). Comparison uses
 * `crypto.timingSafeEqual` and pre-checks lengths to avoid throwing on a
 * mismatch.
 */
function makeHostVerifier(expectedFingerprint) {
    const trimmed = expectedFingerprint.trim();
    let expectedHex;
    if (/^SHA256:[A-Za-z0-9+/=]+$/.test(trimmed)) {
        const b64 = trimmed.slice("SHA256:".length);
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        expectedHex = Buffer.from(padded, "base64").toString("hex");
    }
    else if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0) {
        expectedHex = trimmed.toLowerCase();
    }
    else {
        throw new Error(`Invalid hostKey format: expected "SHA256:<base64>" (as printed by \`ssh-keygen -lf\`) or a hex SHA256 string, got: ${expectedFingerprint}`);
    }
    return (keyHashHex) => {
        const provided = (keyHashHex || "").toLowerCase().replace(/^sha256:/, "");
        if (provided.length !== expectedHex.length)
            return false;
        try {
            return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expectedHex, "hex"));
        }
        catch {
            return false;
        }
    };
}
//# sourceMappingURL=host-verifier.js.map