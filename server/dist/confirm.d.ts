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
export declare function confirmOperation(showInfo: (message: string, ...actions: string[]) => Promise<string | undefined>, prompt: string, confirmLabel: string, cancelLabel?: string): Promise<boolean>;
//# sourceMappingURL=confirm.d.ts.map