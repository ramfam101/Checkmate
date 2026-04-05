import nodemailer from "nodemailer";

export const sendEscalationEmail = async (to: string, escalations: { delay: number; channel: string }[]) => {
	try {
		// Use ethereal test account so this works without external credentials
		const testAccount = await nodemailer.createTestAccount();
		const transporter = nodemailer.createTransport({
			host: testAccount.smtp.host,
			port: testAccount.smtp.port,
			secure: testAccount.smtp.secure,
			auth: {
				user: testAccount.user,
				pass: testAccount.pass,
			},
		});

		const body = `Escalations saved:\n\n${JSON.stringify(escalations, null, 2)}`;

		const info = await transporter.sendMail({
			from: "checkmate@example.com",
			to,
			subject: "Escalations saved (test)",
			text: body,
		});

		// nodemailer provides a preview URL for ethereal
		// Log that email was sent
		// eslint-disable-next-line no-console
		console.log("Email sent", info.messageId, nodemailer.getTestMessageUrl(info));
		return true;
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error("Failed to send escalation email", err);
		return false;
	}
};
