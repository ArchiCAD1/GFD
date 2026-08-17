import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { getAppCheck } from "firebase-admin/app-check";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { calculateEstimate, isPricingComplete, PricingConfiguration } from "./pricing.js";
import { FirestoreEmailQueueProvider, GmailSMTPProvider, QueuedEmail } from "./email.js";
import { buildEstimatePDF } from "./estimate-pdf.js";

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket();
const workspaceID = "gfd-workspace";
const pricingPath = `workspaces/${workspaceID}/publicPricing/current`;
const smtpUser = defineSecret("GFD_SMTP_USER");
const smtpAppPassword = defineSecret("GFD_SMTP_APP_PASSWORD");
const ownerEmail = "gerardofaustindesigns@gmail.com";
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? "http://127.0.0.1:4173,http://localhost:4173")
  .split(",").map(value => value.trim()).filter(Boolean));

const attachmentSchema = z.object({
  id: z.string().uuid(),
  path: z.string().max(500),
  name: z.string().min(1).max(180).regex(/^[^/\\\u0000]+$/),
  size: z.number().int().min(1).max(50 * 1024 * 1024),
  type: z.string().max(100),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i)
});

const areaScheduleSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  category: z.enum(["living", "wet", "service", "other", "chargeable", "circulation"]),
  squareFeet: z.number().min(0).max(2_000_000)
});

const submissionSchema = z.object({
  applicationId: z.string().uuid(),
  contact: z.object({
    name: z.string().min(2).max(120),
    company: z.string().max(160).optional().default(""),
    email: z.string().email().max(240),
    phone: z.string().min(7).max(40),
    preferredContact: z.enum(["email", "whatsapp", "phone"])
  }),
  project: z.object({
    classification: z.enum(["residential", "commercial"]),
    projectType: z.string().min(1).max(100),
    siteAddress: z.string().min(2).max(300),
    parish: z.string().min(2).max(80),
    buildStatus: z.string().max(80),
    stage: z.string().max(100),
    // The browser display is advisory only. The server derives its fee-bearing
    // area from the supplied room schedule, excluding circulation categories.
    squareFeet: z.number().min(0).max(2_000_000),
    grossSquareFeet: z.number().min(0).max(2_000_000).optional().default(0),
    circulationSquareFeet: z.number().min(0).max(2_000_000).optional().default(0),
    areaSchedule: z.array(areaScheduleSchema).max(60).optional().default([]),
    floors: z.number().int().min(1).max(200),
    rooms: z.record(z.string(), z.number().int().min(0).max(500)),
    services: z.array(z.string().max(80)).max(30),
    currency: z.enum(["USD", "JMD"]),
    budgetRange: z.string().max(120),
    desiredStart: z.string().max(40),
    targetCompletion: z.string().max(40),
    scope: z.string().min(20).max(12_000),
    style: z.string().max(8_000).optional().default(""),
    notes: z.string().max(8_000)
  }),
  attachments: z.array(attachmentSchema).max(10),
  consent: z.object({ privacy: z.literal(true), disclaimer: z.literal(true), contact: z.literal(true) }),
  clientEstimate: z.unknown().optional(),
  source: z.string().max(500)
});

function feeBearingArea(project: z.infer<typeof submissionSchema>["project"]): number {
  const scheduled = project.areaSchedule
    .filter(space => space.category !== "circulation")
    .reduce((sum, space) => sum + space.squareFeet, 0);
  const result = project.areaSchedule.length ? scheduled : project.squareFeet;
  if (!Number.isFinite(result) || result < 100 || result > 2_000_000) {
    throw new HttpsError("invalid-argument", "At least 100 sq. ft. of fee-bearing programmed area is required. Circulation is excluded from this total.");
  }
  return Math.round(result);
}

function applyCors(req: any, res: any): boolean {
  const origin = req.get("origin") ?? "";
  if (origin && allowedOrigins.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Firebase-AppCheck, Idempotency-Key");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.status(allowedOrigins.has(origin) ? 204 : 403).send("");
    return true;
  }
  if (origin && !allowedOrigins.has(origin)) {
    res.status(403).json({ error: "Origin is not allowed." });
    return true;
  }
  return false;
}

async function verifyRequest(req: any): Promise<{ uid: string; email: string }> {
  const bearer = String(req.get("authorization") ?? "").match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) throw new HttpsError("unauthenticated", "Verified sign-in is required.");
  const decoded = await getAuth().verifyIdToken(bearer, true);
  if (!decoded.email_verified || !decoded.email) throw new HttpsError("permission-denied", "Email verification is required.");
  if (!process.env.FUNCTIONS_EMULATOR) {
    const appCheck = req.get("x-firebase-appcheck");
    if (!appCheck) throw new HttpsError("failed-precondition", "App Check token is required.");
    await getAppCheck().verifyToken(appCheck);
  }
  await enforceRateLimit(decoded.uid);
  return { uid: decoded.uid, email: decoded.email };
}

async function verifyPublicAppCheck(req: any): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR) return;
  const token = req.get("x-firebase-appcheck");
  if (!token) throw new HttpsError("failed-precondition", "App Check token is required.");
  await getAppCheck().verifyToken(token);
}

async function enforceRateLimit(uid: string): Promise<void> {
  const bucketKey = Math.floor(Date.now() / 60_000);
  const ref = db.doc(`workspaces/${workspaceID}/intakeRateLimits/${uid}-${bucketKey}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const count = Number(snapshot.data()?.count ?? 0);
    if (count >= 20) throw new HttpsError("resource-exhausted", "Too many intake requests. Wait one minute and try again.");
    transaction.set(ref, { count: count + 1, expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000) }, { merge: true });
  });
}

async function readPricing(): Promise<PricingConfiguration> {
  const snap = await db.doc(pricingPath).get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "Pricing has not been configured.");
  const value = snap.data() as PricingConfiguration;
  if (!isPricingComplete(value)) throw new HttpsError("failed-precondition", "Published pricing is incomplete.");
  return value;
}

function sendError(res: any, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = error instanceof HttpsError && error.code === "unauthenticated" ? 401 :
    error instanceof HttpsError && error.code === "permission-denied" ? 403 : 400;
  res.status(status).json({ error: message });
}

async function validateStoredAttachment(attachment: z.infer<typeof attachmentSchema>): Promise<void> {
  const extension = attachment.name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = new Set(["pdf", "jpg", "jpeg", "png", "docx", "xlsx", "dwg", "dxf", "skp"]);
  if (!allowed.has(extension)) throw new HttpsError("invalid-argument", `Unsupported file type: ${attachment.name}`);
  const file = bucket.file(attachment.path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError("invalid-argument", `Missing upload: ${attachment.name}`);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== attachment.size || String(metadata.metadata?.sha256 ?? "").toLowerCase() !== attachment.sha256.toLowerCase()) {
    throw new HttpsError("invalid-argument", `Upload validation failed: ${attachment.name}`);
  }
  const [prefix] = await file.download({ start: 0, end: Math.min(511, attachment.size - 1) });
  const is = (...bytes: number[]) => bytes.every((byte, index) => prefix[index] === byte);
  if (is(0x4d, 0x5a) || is(0x7f, 0x45, 0x4c, 0x46) || is(0xcf, 0xfa, 0xed, 0xfe) || is(0xfe, 0xed, 0xfa, 0xcf)) {
    throw new HttpsError("invalid-argument", `Executable content is not allowed: ${attachment.name}`);
  }
  const textPrefix = prefix.toString("ascii");
  const signatureOK = extension === "pdf" ? textPrefix.startsWith("%PDF-") :
    ["jpg", "jpeg"].includes(extension) ? is(0xff, 0xd8, 0xff) :
    extension === "png" ? is(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) :
    ["docx", "xlsx"].includes(extension) ? is(0x50, 0x4b) :
    extension === "dwg" ? textPrefix.startsWith("AC10") :
    extension === "dxf" ? /SECTION/i.test(textPrefix) :
    extension === "skp" ? /SketchUp/i.test(textPrefix) : false;
  if (!signatureOK) throw new HttpsError("invalid-argument", `File signature does not match its extension: ${attachment.name}`);
}

export const getPublicPricing = onRequest({ region: "us-east1", cors: false }, async (req, res) => {
  if (applyCors(req, res)) return;
  try {
    await verifyPublicAppCheck(req);
    const pricing = await readPricing();
    res.json({
      published: true, version: pricing.version, effectiveDate: pricing.effectiveDate, baseRates: pricing.baseRates,
      roomRates: pricing.roomRates, serviceRates: pricing.serviceRates,
      lowMultiplier: pricing.lowMultiplier, highMultiplier: pricing.highMultiplier,
      gctPercent: pricing.gctPercent, includeGCT: pricing.includeGCT,
      enabledCurrencies: pricing.enabledCurrencies, usdToJmd: pricing.usdToJmd,
      exchangeRateAsOf: pricing.exchangeRateAsOf
    });
  } catch (error) { sendError(res, error); }
});

export const createUploadSession = onRequest({ region: "us-east1", cors: false }, async (req, res) => {
  if (applyCors(req, res)) return;
  try {
    const identity = await verifyRequest(req);
    const applicationId = randomUUID();
    await db.doc(`workspaces/${workspaceID}/projectApplications/${applicationId}`).set({
      ownerUID: identity.uid, applicantEmail: identity.email, status: "uploading",
      createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 90 * 86400000)
    });
    res.json({ applicationId, uploadPrefix: `intakeUploads/${identity.uid}/${applicationId}/`, maxFiles: 10, maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 });
  } catch (error) { sendError(res, error); }
});

export const submitProjectApplication = onRequest({ region: "us-east1", cors: false, timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
  if (applyCors(req, res)) return;
  try {
    const identity = await verifyRequest(req);
    const parsed = submissionSchema.parse(req.body);
    if (parsed.contact.email.toLowerCase() !== identity.email.toLowerCase()) throw new HttpsError("permission-denied", "The verified email does not match the application.");
    const expectedPrefix = `intakeUploads/${identity.uid}/${parsed.applicationId}/`;
    if (parsed.attachments.some(file => !file.path.startsWith(expectedPrefix))) throw new HttpsError("permission-denied", "Invalid upload path.");
    if (parsed.attachments.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new HttpsError("invalid-argument", "Attachments exceed the 200 MB total limit.");

    const pricing = await readPricing();
    const authoritativeSquareFeet = feeBearingArea(parsed.project);
    const authoritativeData = {
      ...parsed,
      project: { ...parsed.project, squareFeet: authoritativeSquareFeet, chargeableSquareFeet: authoritativeSquareFeet }
    };
    const totals = calculateEstimate({
      classification: parsed.project.classification, squareFeet: authoritativeSquareFeet,
      rooms: parsed.project.rooms, services: parsed.project.services, currency: parsed.project.currency
    }, pricing);
    const ref = `GFD-APP-${new Date().getUTCFullYear()}-${parsed.applicationId.slice(0, 8).toUpperCase()}`;
    const applicationRef = db.doc(`workspaces/${workspaceID}/projectApplications/${parsed.applicationId}`);
    const existing = await applicationRef.get();
    if (existing.exists && existing.data()?.status === "new") {
      res.json(existing.data()?.submissionResult);
      return;
    }

    for (const attachment of parsed.attachments) await validateStoredAttachment(attachment);

    const pdfBytes = await buildEstimatePDF(ref, authoritativeData, totals, pricing);
    const pdfPath = `workspaces/${workspaceID}/projectApplications/${parsed.applicationId}/preliminary-estimate.pdf`;
    await bucket.file(pdfPath).save(Buffer.from(pdfBytes), { contentType: "application/pdf", metadata: { metadata: { applicationId: parsed.applicationId, documentKind: "preliminary-estimate", ownerUid: identity.uid } } });
    const submissionResult = {
      applicationId: parsed.applicationId, reference: ref, estimate: totals, pricingVersion: pricing.version,
      pdfStatus: "generated", estimatePDFPath: pdfPath,
      applicantEmailStatus: "queued", ownerEmailStatus: "queued", submittedAt: new Date().toISOString()
    };
    await applicationRef.set({
      ...authoritativeData, clientEstimate: FieldValue.delete(), ownerUID: identity.uid, applicantEmail: identity.email,
      status: "new", unread: true, reference: ref, authoritativeEstimate: totals,
      pricingSnapshot: pricing, estimatePDFPath: pdfPath, submittedAt: FieldValue.serverTimestamp(),
      submissionResult, updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const emailProvider = new FirestoreEmailQueueProvider(db);
    const projectSummary = `${parsed.project.classification} ${parsed.project.projectType}, ${authoritativeSquareFeet.toLocaleString()} sq. ft., ${parsed.project.parish}`;
    await Promise.all([
      emailProvider.queue({ applicationId: parsed.applicationId, workspaceId: workspaceID,
        recipient: parsed.contact.email, recipientType: "applicant", reference: ref, attachmentPath: pdfPath,
        applicantName: parsed.contact.name, projectSummary }),
      emailProvider.queue({ applicationId: parsed.applicationId, workspaceId: workspaceID,
        recipient: ownerEmail, recipientType: "owner", reference: ref, attachmentPath: pdfPath,
        applicantName: parsed.contact.name, projectSummary, ownerAppURL: process.env.OWNER_APP_URL || "gerardofaustin://applications" })
    ]);
    const devices = await db.collection(`workspaces/${workspaceID}/notificationDevices`).where("enabled", "==", true).get();
    const tokens = devices.docs.map(doc => doc.data().token).filter((value): value is string => typeof value === "string");
    if (tokens.length) await getMessaging().sendEachForMulticast({ tokens, notification: { title: "New project application", body: `${parsed.contact.name} submitted ${ref}.` }, data: { applicationId: parsed.applicationId, route: "applications" } });
    res.json(submissionResult);
  } catch (error) { sendError(res, error); }
});

export const sendQueuedEstimateEmail = onDocumentCreated({
  document: "workspaces/{workspaceId}/outboundEmail/{emailId}",
  region: "us-east1",
  secrets: [smtpUser, smtpAppPassword],
  retry: true
}, async event => {
  const snapshot = event.data;
  if (!snapshot) return;
  const ref = snapshot.ref;
  const claimed = await db.runTransaction(async transaction => {
    const current = await transaction.get(ref);
    const value = current.data() as QueuedEmail | undefined;
    if (!value || value.status === "delivered" || value.status === "sending") return false;
    transaction.update(ref, { status: "sending", attemptCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return;
  const message = (await ref.get()).data() as QueuedEmail;
  const applicationRef = db.doc(`workspaces/${message.workspaceId}/projectApplications/${message.applicationId}`);
  const statusField = message.recipientType === "applicant" ? "applicantEmailStatus" : "ownerEmailStatus";
  try {
    const [pdf] = await bucket.file(message.attachmentPath).download();
    const provider = new GmailSMTPProvider(smtpUser.value(), smtpAppPassword.value());
    const result = await provider.send(message, pdf, smtpUser.value());
    await Promise.all([
      ref.update({ status: "delivered", provider: "gmail-smtp", providerMessageId: result.messageId, deliveredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete() }),
      applicationRef.set({ [statusField]: "delivered", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed.";
    await Promise.all([
      ref.update({ status: "failed", lastError: detail, updatedAt: FieldValue.serverTimestamp() }),
      applicationRef.set({ [statusField]: "failed", updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    ]);
    throw error;
  }
});

function requireWorkspaceRole(auth: any): void {
  if (!auth || auth.token.workspace_id !== workspaceID || !["admin", "editor"].includes(auth.token.workspace_role)) {
    throw new HttpsError("permission-denied", "Workspace editor access is required.");
  }
}

export const updateApplicationStatus = onCall({ region: "us-east1", enforceAppCheck: true }, async request => {
  requireWorkspaceRole(request.auth);
  const value = z.object({ id: z.string().uuid(), status: z.enum(["new", "reviewing", "quoted", "rejected"]) }).parse(request.data);
  await db.doc(`workspaces/${workspaceID}/projectApplications/${value.id}`).update({ status: value.status, unread: false, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const reserveDocumentNumber = onCall({ region: "us-east1", enforceAppCheck: true }, async request => {
  requireWorkspaceRole(request.auth);
  const kind = z.enum(["quotation", "invoice"]).parse(request.data?.kind);
  const counterRef = db.doc(`workspaces/${workspaceID}/documentCounters/${kind}`);
  return db.runTransaction(async transaction => {
    const snap = await transaction.get(counterRef);
    const next = Number(snap.data()?.next ?? 1);
    transaction.set(counterRef, { next: next + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { number: `${kind === "quotation" ? "QTE" : "INV"}-${new Date().getUTCFullYear()}-${String(next).padStart(4, "0")}` };
  });
});

export const cleanupExpiredIntakes = onSchedule({ schedule: "every day 03:15", timeZone: "America/Jamaica", region: "us-east1" }, async () => {
  const expired = await db.collection(`workspaces/${workspaceID}/projectApplications`).where("expiresAt", "<=", Timestamp.now()).limit(200).get();
  for (const doc of expired.docs) {
    const data = doc.data();
    if (!["uploading", "rejected"].includes(data.status)) continue;
    const prefix = `intakeUploads/${data.ownerUID}/${doc.id}/`;
    await bucket.deleteFiles({ prefix, force: true });
    await doc.ref.set({ contact: FieldValue.delete(), project: FieldValue.delete(), attachments: FieldValue.delete(), status: "purged", purgedAt: FieldValue.serverTimestamp(), audit: { reference: data.reference ?? doc.id, priorStatus: data.status } }, { merge: true });
  }
});
