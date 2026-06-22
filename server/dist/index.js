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
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const path = __importStar(require("path"));
const sftp_client_1 = require("./sftp-client");
const config_1 = require("./config");
const confirm_1 = require("./confirm");
// Add error handlers
process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    process.exit(1);
});
process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
// Create a connection for the server
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
// Create a simple text document manager
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceFolder;
let configManager;
let sftpClient;
connection.onInitialize((params) => {
    if (params.workspaceFolders && params.workspaceFolders.length > 0) {
        workspaceFolder = params.workspaceFolders[0].uri.replace("file://", "");
    }
    const result = {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: node_1.TextDocumentSyncKind.Full,
                save: {
                    includeText: false,
                },
            },
            executeCommandProvider: {
                commands: ["sftp.upload", "sftp.download", "sftp.sync", "sftp.uploadFolder", "sftp.downloadFolder"],
            },
        },
    };
    return result;
});
connection.onInitialized(async () => {
    connection.console.log("SFTP Language Server initialized");
    if (workspaceFolder) {
        try {
            configManager = new config_1.ConfigManager(workspaceFolder);
            const config = await configManager.loadConfig();
            if (config) {
                sftpClient = new sftp_client_1.SftpClient(config, connection, configManager);
                connection.console.log(`SFTP config loaded for ${config.host}`);
                // Log context path if set
                if (config.context) {
                    connection.console.log(`Context path: ${config.context} -> ${configManager.getContextPath()}`);
                }
                // Start file watcher if uploadOnSave is enabled
                if (config.uploadOnSave) {
                    connection.console.log("Upload on save is enabled");
                }
            }
            else {
                connection.console.warn("No SFTP config found");
            }
        }
        catch (error) {
            connection.console.error(`Failed to initialize SFTP: ${error}`);
        }
    }
});
// Handle document save
documents.onDidSave(async (event) => {
    if (!sftpClient || !configManager) {
        return;
    }
    const config = await configManager.loadConfig();
    if (!config || !config.uploadOnSave) {
        return;
    }
    const filePath = event.document.uri.replace("file://", "");
    // Check if file is within context path
    if (!configManager.isInContext(filePath)) {
        connection.console.log(`File is outside context path: ${filePath}`);
        return;
    }
    // Check if file should be ignored
    if (configManager.shouldIgnore(filePath)) {
        connection.console.log(`Ignoring file: ${filePath}`);
        return;
    }
    try {
        connection.console.log(`Uploading file on save: ${filePath}`);
        await sftpClient.uploadFile(filePath);
        connection.window.showInformationMessage(`Uploaded: ${path.basename(filePath)}`);
    }
    catch (error) {
        connection.console.error(`Failed to upload file: ${error}`);
        connection.window.showErrorMessage(`Failed to upload: ${error}`);
    }
});
// Handle commands
connection.onExecuteCommand(async (params) => {
    if (!sftpClient || !configManager) {
        connection.window.showErrorMessage("SFTP not configured");
        return;
    }
    const config = configManager.getConfig();
    const confirmOn = config?.confirmOperations !== false;
    const showInfo = connection.window.showInformationMessage.bind(connection.window);
    try {
        switch (params.command) {
            case "sftp.upload": {
                if (!params.arguments || !params.arguments[0])
                    return;
                const filePath = params.arguments[0];
                const remotePath = configManager.getRemotePath(filePath);
                if (!remotePath) {
                    connection.window.showErrorMessage(`File is outside context path: ${path.basename(filePath)}`);
                    return;
                }
                if (confirmOn) {
                    const ok = await (0, confirm_1.confirmOperation)(showInfo, `Upload "${path.basename(filePath)}" to ${config?.host}:${remotePath}?`, "Yes, upload");
                    if (!ok) {
                        connection.console.log(`Upload cancelled: ${filePath}`);
                        return;
                    }
                }
                await sftpClient.uploadFile(filePath);
                connection.window.showInformationMessage(`Uploaded: ${path.basename(filePath)}`);
                break;
            }
            case "sftp.download": {
                if (!params.arguments || !params.arguments[0])
                    return;
                const filePath = params.arguments[0];
                const remotePath = configManager.getRemotePath(filePath);
                if (!remotePath) {
                    connection.window.showErrorMessage(`File is outside context path: ${path.basename(filePath)}`);
                    return;
                }
                if (confirmOn) {
                    const ok = await (0, confirm_1.confirmOperation)(showInfo, `Download "${path.basename(filePath)}" from ${config?.host}:${remotePath}? ` +
                        `This will overwrite the local file.`, "Yes, download");
                    if (!ok) {
                        connection.console.log(`Download cancelled: ${filePath}`);
                        return;
                    }
                }
                await sftpClient.downloadFile(filePath);
                connection.window.showInformationMessage(`Downloaded: ${path.basename(filePath)}`);
                break;
            }
            case "sftp.sync": {
                const folderPath = workspaceFolder;
                const remotePath = configManager.getRemotePath(folderPath);
                if (!remotePath) {
                    connection.window.showErrorMessage(`Workspace folder is outside context path: ${folderPath}`);
                    return;
                }
                if (confirmOn) {
                    const ok = await (0, confirm_1.confirmOperation)(showInfo, `Sync workspace to ${config?.host}:${remotePath}? ` +
                        `Remote files may be overwritten or deleted.`, "Yes, sync");
                    if (!ok) {
                        connection.console.log(`Sync cancelled: ${folderPath}`);
                        return;
                    }
                }
                await sftpClient.syncFolder(folderPath);
                connection.window.showInformationMessage("Sync completed");
                break;
            }
            case "sftp.uploadFolder": {
                if (!params.arguments || !params.arguments[0])
                    return;
                const folderPath = params.arguments[0];
                const remotePath = configManager.getRemotePath(folderPath);
                if (!remotePath) {
                    connection.window.showErrorMessage(`Folder is outside context path: ${path.basename(folderPath)}`);
                    return;
                }
                if (confirmOn) {
                    const ok = await (0, confirm_1.confirmOperation)(showInfo, `Upload folder "${path.basename(folderPath)}" to ${config?.host}:${remotePath}?`, "Yes, upload");
                    if (!ok) {
                        connection.console.log(`Upload folder cancelled: ${folderPath}`);
                        return;
                    }
                }
                await sftpClient.uploadFolder(folderPath);
                connection.window.showInformationMessage(`Uploaded folder: ${path.basename(folderPath)}`);
                break;
            }
            case "sftp.downloadFolder": {
                if (!params.arguments || !params.arguments[0])
                    return;
                const folderPath = params.arguments[0];
                const remotePath = configManager.getRemotePath(folderPath);
                if (!remotePath) {
                    connection.window.showErrorMessage(`Folder is outside context path: ${path.basename(folderPath)}`);
                    return;
                }
                if (confirmOn) {
                    const ok = await (0, confirm_1.confirmOperation)(showInfo, `Download folder "${path.basename(folderPath)}" from ${config?.host}:${remotePath}? ` +
                        `Local files may be overwritten.`, "Yes, download");
                    if (!ok) {
                        connection.console.log(`Download folder cancelled: ${folderPath}`);
                        return;
                    }
                }
                await sftpClient.downloadFolder(folderPath);
                connection.window.showInformationMessage(`Downloaded folder: ${path.basename(folderPath)}`);
                break;
            }
            default:
                connection.window.showErrorMessage(`Unknown command: ${params.command}`);
        }
    }
    catch (error) {
        connection.console.error(`Command failed: ${error}`);
        connection.window.showErrorMessage(`Command failed: ${error}`);
    }
});
// Make the text document manager listen on the connection
documents.listen(connection);
// Listen on the connection
connection.listen();
//# sourceMappingURL=index.js.map