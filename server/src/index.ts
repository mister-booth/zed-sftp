import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	TextDocumentSyncKind,
	InitializeResult,
	ExecuteCommandParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "path";
import * as fs from "fs";
import { SftpClient } from "./sftp-client";
import { ConfigManager } from "./config";
import { confirmOperation } from "./confirm";

// Add error handlers
process.on("uncaughtException", (error) => {
	console.error("Uncaught Exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceFolder: string | undefined;
let configManager: ConfigManager | undefined;
let sftpClient: SftpClient | undefined;

connection.onInitialize((params: InitializeParams) => {
	if (params.workspaceFolders && params.workspaceFolders.length > 0) {
		workspaceFolder = params.workspaceFolders[0].uri.replace("file://", "");
	}

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Full,
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
			configManager = new ConfigManager(workspaceFolder);
			const config = await configManager.loadConfig();

			if (config) {
				sftpClient = new SftpClient(config, connection, configManager);
				connection.console.log(`SFTP config loaded for ${config.host}`);

				// Log context path if set
				if (config.context) {
					connection.console.log(`Context path: ${config.context} -> ${configManager.getContextPath()}`);
				}

				// Start file watcher if uploadOnSave is enabled
				if (config.uploadOnSave) {
					connection.console.log("Upload on save is enabled");
				}
			} else {
				connection.console.warn("No SFTP config found");
			}
		} catch (error) {
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
	} catch (error) {
		connection.console.error(`Failed to upload file: ${error}`);
		connection.window.showErrorMessage(`Failed to upload: ${error}`);
	}
});

// Handle commands
connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
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
				if (!params.arguments || !params.arguments[0]) return;
				const filePath = params.arguments[0] as string;
				const remotePath = configManager.getRemotePath(filePath);

				if (!remotePath) {
					connection.window.showErrorMessage(
						`File is outside context path: ${path.basename(filePath)}`,
					);
					return;
				}

				if (confirmOn) {
					const ok = await confirmOperation(
						showInfo,
						`Upload "${path.basename(filePath)}" to ${config?.host}:${remotePath}?`,
						"Yes, upload",
					);
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
				if (!params.arguments || !params.arguments[0]) return;
				const filePath = params.arguments[0] as string;
				const remotePath = configManager.getRemotePath(filePath);

				if (!remotePath) {
					connection.window.showErrorMessage(
						`File is outside context path: ${path.basename(filePath)}`,
					);
					return;
				}

				if (confirmOn) {
					const ok = await confirmOperation(
						showInfo,
						`Download "${path.basename(filePath)}" from ${config?.host}:${remotePath}? ` +
						`This will overwrite the local file.`,
						"Yes, download",
					);
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
				const folderPath = workspaceFolder!;
				const remotePath = configManager.getRemotePath(folderPath);

				if (!remotePath) {
					connection.window.showErrorMessage(
						`Workspace folder is outside context path: ${folderPath}`,
					);
					return;
				}

				if (confirmOn) {
					const ok = await confirmOperation(
						showInfo,
						`Sync workspace to ${config?.host}:${remotePath}? ` +
						`Remote files may be overwritten or deleted.`,
						"Yes, sync",
					);
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
				if (!params.arguments || !params.arguments[0]) return;
				const folderPath = params.arguments[0] as string;
				const remotePath = configManager.getRemotePath(folderPath);

				if (!remotePath) {
					connection.window.showErrorMessage(
						`Folder is outside context path: ${path.basename(folderPath)}`,
					);
					return;
				}

				if (confirmOn) {
					const ok = await confirmOperation(
						showInfo,
						`Upload folder "${path.basename(folderPath)}" to ${config?.host}:${remotePath}?`,
						"Yes, upload",
					);
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
				if (!params.arguments || !params.arguments[0]) return;
				const folderPath = params.arguments[0] as string;
				const remotePath = configManager.getRemotePath(folderPath);

				if (!remotePath) {
					connection.window.showErrorMessage(
						`Folder is outside context path: ${path.basename(folderPath)}`,
					);
					return;
				}

				if (confirmOn) {
					const ok = await confirmOperation(
						showInfo,
						`Download folder "${path.basename(folderPath)}" from ${config?.host}:${remotePath}? ` +
						`Local files may be overwritten.`,
						"Yes, download",
					);
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
	} catch (error) {
		connection.console.error(`Command failed: ${error}`);
		connection.window.showErrorMessage(`Command failed: ${error}`);
	}
});


// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();
