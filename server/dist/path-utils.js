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
exports.expandHome = expandHome;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
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
function expandHome(p) {
    if (p === "~")
        return os.homedir();
    if (p.startsWith("~")) {
        const rest = p.slice(1);
        if (rest === "" || rest.startsWith("/") || rest.startsWith(path.sep)) {
            return path.join(os.homedir(), rest);
        }
    }
    return p;
}
//# sourceMappingURL=path-utils.js.map