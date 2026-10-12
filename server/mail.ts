import nodemailer from "nodemailer";
import { config } from "./config.ts";

const transport = config.smtp ? nodemailer.createTransport(config.smtp.url) : null;

export async function sendLoginEmail(to: string, code: string, link: string) {
  const text = `Your Qriz login code is ${code}\n\nOr open this link on the device you want to sign in on:\n${link}\n\nThe code and link expire in 15 minutes. If you did not request this, ignore this email.`;
  if (!transport) {
    console.log(`\n[mail] to=${to}\n  code: ${code}\n  link: ${link}\n`);
    return;
  }
  await transport.sendMail({ from: config.smtp!.from, to, subject: `Qriz login code: ${code}`, text });
}
