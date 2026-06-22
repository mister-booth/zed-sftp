"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmOperation = confirmOperation;
/**
 * Show a yes/no confirmation prompt and return whether the user confirmed.
 *
 * Returns `true` if the user clicked the confirm action, `false` otherwise
 * (including if they dismissed the message without choosing).
 *
 * The `showInfo` parameter is the LSP `Window/showMessageRequest` call —
 * accepting it directly (rather than a full `window` object) keeps the
 * helper trivially mockable in tests.
 */
async function confirmOperation(showInfo, prompt, confirmLabel, cancelLabel = "Cancel") {
    const result = await showInfo(prompt, confirmLabel, cancelLabel);
    return result === confirmLabel;
}
//# sourceMappingURL=confirm.js.map