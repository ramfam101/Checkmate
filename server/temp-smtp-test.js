const nodemailer = require("nodemailer");

(async () => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: "danyka25@ethereal.email",
        pass: "Uxjn7nMMv9FE29PXE7",
      },
    });

    const ok = await transporter.verify();
    console.log("VERIFY", ok);

    const info = await transporter.sendMail({
      from: "danyka25@ethereal.email",
      to: "test@example.com",
      subject: "Ethereal test",
      text: "Ethereal test message",
    });

    console.log("SENT", info.messageId, info.response);
    transporter.close();
  } catch (err) {
    console.error("ERROR", err);
    process.exit(1);
  }
})();
