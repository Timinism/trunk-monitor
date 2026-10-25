import nodemailer from "nodemailer";
import { parseRecipients } from "./settings";
import type { EmailStatus, Settings } from "./types";

export type OutboundMail = {
  to: string[];
  from: string;
  subject: string;
  text: string;
  html: string;
};

type MailSender = (mail: OutboundMail) => Promise<void>;

let testSender: MailSender | null = null;

export function setMailSenderForTests(sender: MailSender | null) {
  if (process.env.NODE_ENV === "production") return;
  testSender = sender;
}

export async function deliverMail(
  settings: Settings,
  message: { subject: string; text: string; html: string },
): Promise<{ status: EmailStatus; detail: string }> {
  const to = parseRecipients(settings.alertRecipients);
  const mail: OutboundMail = {
    to,
    from: settings.alertFrom,
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (testSender) {
    await testSender(mail);
    return { status: "sent", detail: `Accepted for ${to.join(", ") || "the test sender"}` };
  }
  if (!settings.smtpHost.trim()) {
    return { status: "skipped", detail: "SMTP host is not configured." };
  }
  if (to.length === 0) {
    return { status: "skipped", detail: "No alert recipients are configured." };
  }
  try {
    const transport = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      auth: settings.smtpUser
        ? { user: settings.smtpUser, pass: settings.smtpPassword }
        : undefined,
    });
    await transport.sendMail({
      from: mail.from,
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { status: "sent", detail: `Sent to ${to.join(", ")}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Email failed.";
    return { status: "failed", detail };
  }
}
