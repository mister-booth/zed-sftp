import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { confirmOperation } from "../src/confirm";

describe("confirmOperation", () => {
	test("returns true when the user clicks the confirm action", async () => {
		const showInfo = async (_msg: string, ..._actions: string[]) =>
			"Yes, upload" as string | undefined;
		const result = await confirmOperation(
			showInfo,
			"Upload foo.txt?",
			"Yes, upload",
		);
		assert.equal(result, true);
	});

	test("returns false when the user clicks Cancel", async () => {
		const showInfo = async (_msg: string, ..._actions: string[]) =>
			"Cancel" as string | undefined;
		const result = await confirmOperation(
			showInfo,
			"Upload foo.txt?",
			"Yes, upload",
		);
		assert.equal(result, false);
	});

	test("returns false when the user dismisses the dialog (undefined)", async () => {
		const showInfo = async (_msg: string, ..._actions: string[]) =>
			undefined as string | undefined;
		const result = await confirmOperation(
			showInfo,
			"Upload foo.txt?",
			"Yes, upload",
		);
		assert.equal(result, false);
	});

	test("uses custom confirm and cancel labels", async () => {
		const seenPrompt: string[] = [];
		const seenActions: string[][] = [];
		const showInfo = async (msg: string, ...actions: string[]) => {
			seenPrompt.push(msg);
			seenActions.push(actions);
			return "Ship it" as string | undefined;
		};

		const result = await confirmOperation(
			showInfo,
			"Deploy to prod?",
			"Ship it",
			"Hold off",
		);

		assert.equal(result, true);
		assert.equal(seenPrompt[0], "Deploy to prod?");
		assert.deepEqual(seenActions[0], ["Ship it", "Hold off"]);
	});

	test("returns false when the result is a different label (not strict match)", async () => {
		// Guard against future LSP implementations that return arbitrary
		// action strings — only the exact confirm label counts.
		const showInfo = async (_msg: string, ..._actions: string[]) =>
			"Yes, upload but actually do something else" as string | undefined;
		const result = await confirmOperation(
			showInfo,
			"Upload foo.txt?",
			"Yes, upload",
		);
		assert.equal(result, false);
	});

	test("passes the prompt and actions to the underlying LSP call", async () => {
		let captured: { msg: string; actions: string[] } | null = null;
		const showInfo = async (msg: string, ...actions: string[]) => {
			captured = { msg, actions };
			return undefined;
		};
		await confirmOperation(showInfo, "Upload foo.txt?", "Yes", "No");
		assert.equal(captured!.msg, "Upload foo.txt?");
		assert.deepEqual(captured!.actions, ["Yes", "No"]);
	});

	test("uses 'Cancel' as the default cancel label", async () => {
		let captured: { msg: string; actions: string[] } | null = null;
		const showInfo = async (msg: string, ...actions: string[]) => {
			captured = { msg, actions };
			return undefined;
		};
		// Pass only confirmLabel — cancelLabel should default to "Cancel".
		await confirmOperation(showInfo, "Sync?", "Yes, sync");
		assert.deepEqual(captured!.actions, ["Yes, sync", "Cancel"]);
	});
});