
import * as dotenv from "dotenv";
dotenv.config();

import nodemailer from "nodemailer";
import { MailtrapTransport } from "mailtrap";


export const MAILING_LIST: string[] = [
    "verdev.web@gmail.com",
    "mail2@example.com",
];

export function isAllowedEmail(email: string): boolean {
    return MAILING_LIST.some(e => e.toLowerCase() === email.toLowerCase());
}

export async function sendEmail(to: string, subject: string, body: string): Promise<string> {
    const mailtrapToken = process.env.MAILTRAP_TOKEN;
    const from = process.env.MAIL_FROM || "hello@verdevweb.com";

    // Mailtrap (API token)
    if (mailtrapToken) {
        const transport = nodemailer.createTransport(
            MailtrapTransport({ token: mailtrapToken })
        );
        await transport.sendMail({
            from: { address: from, name: "AutoQA Agent" },
            to: [{ address: to }],
            subject,
            text: body,
        });
        return `Email inviata con successo a ${to} via Mailtrap`;
    }

    // Standard SMTP (Brevo, Gmail, SendGrid, ecc.)
    const host = process.env.SMTP_HOST;
    if (!host) throw new Error("Configura MAILTRAP_TOKEN o SMTP_HOST in .env");
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || "";

    const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
    });

    await transport.sendMail({
        from: from,
        to: to,
        subject: subject,
        text: body,
    });

    return `Email inviata con successo a ${to}`;
}

