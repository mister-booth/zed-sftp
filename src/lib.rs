use std::{env, fs};

use zed_extension_api as zed;

const PACKAGE_NAME: &str = "zed-sftp-server";
// SECURITY: pinned to a specific version to prevent running code from a
// compromised or squatted npm package. Bump this constant and ship a new
// extension release to roll out a new server version.
const PACKAGE_VERSION: &str = "1.0.1";
const SERVER_PATH: &str = "node_modules/zed-sftp-server/dist/index.js";

struct SftpExtension {
    cached_server_path: Option<String>,
}

impl SftpExtension {
    fn server_exists(&self) -> bool {
        fs::metadata(SERVER_PATH).map_or(false, |stat| stat.is_file())
    }

    fn server_script_path(
        &mut self,
        language_server_id: &zed::LanguageServerId,
    ) -> zed::Result<String> {
        if let Some(cached_server_path) = &self.cached_server_path {
            if fs::metadata(cached_server_path).map_or(false, |stat| stat.is_file()) {
                return Ok(cached_server_path.clone());
            }
        }

        let installed_version = zed::npm_package_installed_version(PACKAGE_NAME)?;

        if !self.server_exists() || installed_version.as_deref() != Some(PACKAGE_VERSION) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );

            match zed::npm_install_package(PACKAGE_NAME, PACKAGE_VERSION) {
                Ok(()) => {
                    if !self.server_exists() {
                        return Err(format!(
                            "Installed package '{PACKAGE_NAME}' did not contain expected path '{SERVER_PATH}'"
                        ));
                    }
                    // Supply-chain defense: verify the installed version matches
                    // the pinned version. A compromised or squatted npm package
                    // publishing a different version would be caught here.
                    let post_install_version =
                        zed::npm_package_installed_version(PACKAGE_NAME)?;
                    if post_install_version.as_deref() != Some(PACKAGE_VERSION) {
                        return Err(format!(
                            "Installed version '{:?}' does not match pinned version '{}'. \
                            Refusing to run unverified code.",
                            post_install_version, PACKAGE_VERSION,
                        ));
                    }
                }
                Err(error) => {
                    if !self.server_exists() {
                        return Err(error);
                    }
                    // Install failed but a prior install exists. Verify the
                    // existing version matches the pin; if not, refuse to run
                    // rather than fall back to an unverified installation.
                    let existing_version =
                        zed::npm_package_installed_version(PACKAGE_NAME)?;
                    if existing_version.as_deref() != Some(PACKAGE_VERSION) {
                        return Err(format!(
                            "Install failed and existing version '{:?}' does not match \
                            pinned version '{}'. Refusing to run unverified code. \
                            Original error: {}",
                            existing_version, PACKAGE_VERSION, error,
                        ));
                    }
                }
            }
        }

        let server_path = env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?
            .join(SERVER_PATH)
            .to_string_lossy()
            .to_string();

        self.cached_server_path = Some(server_path.clone());
        Ok(server_path)
    }
}

impl zed::Extension for SftpExtension {
    fn new() -> Self {
        Self {
            cached_server_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let server_path = self.server_script_path(language_server_id)?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(SftpExtension);