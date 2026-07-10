import { Worker } from "@project-ajax/sdk";

const worker = new Worker();
export default worker;

type RichTextProperty = {
	type: "rich_text";
	rich_text: Array<{ plain_text: string }>;
};

/**
 * Example automation that processes questions from database pages.
 *
 * This automation:
 * 1. Reads a question from a page property
 * 2. Processes it (calls an API, performs logic, etc.)
 * 3. Updates the page with the answer
 */
worker.automation("questionAnswerAutomation", {
	title: "Question Answer Automation",
	description:
		"Reads questions from database pages and updates them with answers",
	execute: async (event, { notion }) => {
		const { pageId, pageData } = event;
		// Extract email from the page dat
		const emailProperty = pageData?.properties?.Email as
			| RichTextProperty
			| undefined;

		// Extract text content from the property
		let emailValue = "";
		if (emailProperty?.type === "rich_text") {
			emailValue = emailProperty.rich_text.map((rt) => rt.plain_text).join("");
		}

		// Handle empty email
		if (!emailValue) {
			return;
		}

		await sendEmail(emailValue);

		// Update the page to indicate the email has been sent
		await notion.pages.update({
			page_id: pageId,
			properties: {
				EmailSent: {
					// Notion has a 2000 character limit for rich_text
					checkbox: true,
				},
			},
		});
	},
});

async function sendEmail(email: string): Promise<void> {
	console.log(`Sending email to ${email}`);
}
