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
exports.ConfigManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const minimatch_1 = require("minimatch");
const env_1 = require("./env");
class ConfigManager {
    constructor(workspaceFolder) {
        this.config = null;
        this.ignorePatterns = [];
        this.contextPath = ""; // Resolved context path
        this.workspaceFolder = workspaceFolder;
    }
    async loadConfig() {
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
            if (this.config.protocol !== undefined &&
                this.config.protocol !== "sftp") {
                throw new Error(`Unsupported protocol: "${this.config.protocol}". ` +
                    `This build only supports "sftp". ` +
                    `FTP and FTPS are not implemented; remove the "protocol" field ` +
                    `(or set it to "sftp") to use SFTP.`);
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
                }
                else {
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
                this.config.password = (0, env_1.resolveEnv)(this.config.password);
                this.config.passphrase = (0, env_1.resolveEnv)(this.config.passphrase);
            }
            return this.config;
        }
        catch (error) {
            throw new Error(`Failed to parse SFTP config: ${error}`);
        }
    }
    shouldIgnore(filePath) {
        const relativePath = path.relative(this.workspaceFolder, filePath);
        for (const pattern of this.ignorePatterns) {
            if ((0, minimatch_1.minimatch)(relativePath, pattern, { dot: true })) {
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
    isInContext(filePath) {
        const normalized = path.normalize(filePath);
        let contextNormalized = path.normalize(this.contextPath);
        // Strip a single trailing separator so we can safely append
        // `path.sep` when forming the boundary. Preserve the filesystem
        // root (`/` on POSIX, `C:\` on Windows) as its own boundary.
        if (contextNormalized.length > 1 &&
            contextNormalized.endsWith(path.sep)) {
            contextNormalized = contextNormalized.slice(0, -path.sep.length);
        }
        if (normalized === contextNormalized) {
            return true;
        }
        const boundary = contextNormalized + path.sep;
        return (normalized.length > boundary.length &&
            normalized.startsWith(boundary));
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
    getRemotePath(localFilePath) {
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
        return path.posix.join(remotePath, relativePath.split(path.sep).join("/"));
    }
    getConfig() {
        return this.config;
    }
    getContextPath() {
        return this.contextPath;
    }
    async reloadConfig() {
        return this.loadConfig();
    }
}
exports.ConfigManager = ConfigManager;
//# sourceMappingURL=config.js.map