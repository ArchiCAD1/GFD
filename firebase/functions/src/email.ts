import { FieldValue, Firestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

export type RecipientType = "applicant" | "owner";

export interface PreliminaryEstimateEmail {
  applicationId: string;
  workspaceId: string;
  recipient: string;
  recipientType: RecipientType;
  reference: string;
  attachmentPath: string;
  applicantName: string;
  projectSummary: string;
  ownerAppURL?: string;
}

export interface QueuedEmail extends PreliminaryEstimateEmail {
  id: string;
  subject: string;
  text: string;
  html: string;
  status: "queued" | "sending" | "delivered" | "failed";
  attemptCount: number;
  idempotencyKey: string;
}

export class FirestoreEmailQueueProvider {
  constructor(private readonly db: Firestore) {}

  async queue(message: PreliminaryEstimateEmail): Promise<{ id: string; status: "queued" }> {
    const id = `${message.applicationId}-${message.recipientType}`;
    const applicant = message.recipientType === "applicant";
    const subject = applicant
      ? `${message.reference} - your preliminary project estimate`
      : `New project application ${message.reference} from ${message.applicantName}`;
    const action = message.ownerAppURL || "Open the Gerardo Faustin Designs application inbox to review the submission.";
    const text = applicant
      ? `Hello ${message.applicantName},\n\nWe received your project application ${message.reference}. Your preliminary estimate is attached. It is not a quotation, invoice, offer, or contract. Gerardo will review the scope before any formal quotation is issued.\n\nGerardo Faustin Designs Limited\nWhatsApp +1 876 805 6385`
      : `A new project application is ready for review.\n\nReference: ${message.reference}\nApplicant: ${message.applicantName}\nProject: ${message.projectSummary}\n\n${action}`;
    const html = `<div style="font-family:Arial,sans-serif;color:#13243d;line-height:1.55;max-width:640px"><div style="background:#13243d;color:white;padding:22px 26px;border-radius:18px 18px 0 0"><strong style="font-size:20px">Gerardo Faustin Designs Limited</strong></div><div style="border:1px solid #d7dce4;border-top:0;padding:28px;border-radius:0 0 18px 18px"><p style="color:#b28332;text-transform:uppercase;letter-spacing:.08em;font-size:12px">${applicant ? "Application received" : "New project application"}</p><h1 style="font-family:Georgia,serif;font-size:30px;margin:8px 0 18px">${message.reference}</h1><p>${applicant ? `Hello ${message.applicantName}, your application has been received and the preliminary estimate is attached.` : `${message.applicantName} submitted ${message.projectSummary}.`}</p><p><strong>This preliminary estimate is not a quotation, invoice, offer, or contract.</strong></p>${applicant ? "<p>Gerardo will personally review your project before a formal quotation is prepared.</p>" : `<p><a href="${message.ownerAppURL || "#"}" style="display:inline-block;background:#173b2d;color:white;text-decoration:none;padding:12px 18px;border-radius:999px">Review application</a></p>`}<hr style="border:0;border-top:1px solid #d7dce4;margin:24px 0"><p style="font-size:13px;color:#667085">gerardofaustindesigns@gmail.com<br>WhatsApp +1 876 805 6385</p></div></div>`;
    await this.db.doc(`workspaces/${message.workspaceId}/outboundEmail/${id}`).set({
      ...message, id, subject, text, html, template: `preliminary-estimate-${message.recipientType}`,
      status: "queued", attemptCount: 0, idempotencyKey: id, createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: false });
    return { id, status: "queued" };
  }
}

export class GmailSMTPProvider {
  private readonly transport;

  constructor(user: string, appPassword: string) {
    this.transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass: appPassword },
      pool: true,
      maxConnections: 2,
      maxMessages: 40
    });
  }

  async send(message: QueuedEmail, pdf: Buffer, sender: string): Promise<{ messageId: string }> {
    const result = await this.transport.sendMail({
      from: `Gerardo Faustin Designs <${sender}>`,
      to: message.recipient,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: `<${message.idempotencyKey}@gfd-mail>`,
      attachments: [{ filename: `${message.reference}-preliminary-estimate.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    return { messageId: result.messageId };
  }
}
