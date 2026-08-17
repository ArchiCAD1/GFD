import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { EstimateResult, PricingConfiguration } from "./pricing.js";

type Submission = {
  contact: { name: string; company?: string; email: string; phone: string; preferredContact: string };
  project: {
    classification: string; projectType: string; stage: string; buildStatus: string;
    siteAddress: string; parish: string; floors: number; squareFeet: number;
    circulationSquareFeet?: number; areaSchedule?: Array<{ id: string; label: string; squareFeet: number }>;
    services: string[]; desiredStart: string; targetCompletion: string; budgetRange: string;
    scope: string; style?: string; notes: string;
  };
  attachments: Array<{ name: string }>;
};

const clean = (value: unknown): string => String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
const titleCase = (value: unknown): string => clean(value).replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, letter => letter.toUpperCase());
const money = (value: number, currency: string): string => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);

function wrap(font: PDFFont, text: unknown, size: number, width: number): string[] {
  const words = clean(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function buildEstimatePDF(reference: string, data: Submission, totals: EstimateResult, pricing: PricingConfiguration): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const serif = await document.embedFont(StandardFonts.TimesRomanBold);
  const navy = rgb(0.07, 0.14, 0.24);
  const blue = rgb(0.20, 0.29, 0.58);
  const gold = rgb(0.74, 0.55, 0.20);
  const paleBlue = rgb(0.93, 0.95, 0.98);
  const paleGold = rgb(0.98, 0.96, 0.91);
  const gray = rgb(0.42, 0.45, 0.46);
  const divider = rgb(0.82, 0.84, 0.84);
  const width = 612;
  const height = 792;
  const margin = 38;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  let logo: Awaited<ReturnType<PDFDocument["embedJpg"]>> | undefined;
  try {
    const bytes = await readFile(join(__dirname, "../assets/gerardo-faustin-designs-logo.jpg"));
    logo = await document.embedJpg(bytes);
  } catch { logo = undefined; }

  const addPage = (continuation: boolean): void => {
    page = document.addPage([width, height]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: 716, width, height: 76, color: navy });
    page.drawText("GERARDO FAUSTIN", { x: margin, y: 755, font: serif, size: 18, color: rgb(1, 1, 1) });
    page.drawText("DESIGNS LIMITED", { x: margin, y: 735, font: bold, size: 10, color: rgb(0.86, 0.89, 0.93) });
    if (logo) page.drawImage(logo, { x: 278, y: 724, width: 55, height: 55 });
    page.drawText(continuation ? "ESTIMATE - CONTINUED" : "PRELIMINARY ESTIMATE", { x: 378, y: 750, font: bold, size: 11, color: rgb(1, 1, 1) });
    page.drawText(clean(reference), { x: 378, y: 733, font: regular, size: 8.5, color: rgb(0.86, 0.89, 0.93) });
    y = 690;
  };
  const ensure = (needed: number): void => { if (y - needed < 78) addPage(true); };
  const section = (title: string): void => {
    ensure(70);
    page.drawRectangle({ x: margin, y: y - 21, width: width - margin * 2, height: 24, color: blue });
    page.drawText(clean(title).toUpperCase(), { x: margin + 10, y: y - 14, font: bold, size: 9, color: rgb(1, 1, 1) });
    y -= 31;
  };
  const row = (label: string, value: string, fill?: ReturnType<typeof rgb>): void => {
    const lines = wrap(regular, value || "-", 9, 390);
    const rowHeight = Math.max(28, lines.length * 12 + 12);
    ensure(rowHeight);
    if (fill) page.drawRectangle({ x: margin, y: y - rowHeight, width: width - margin * 2, height: rowHeight, color: fill });
    page.drawText(clean(label).toUpperCase(), { x: margin + 10, y: y - 17, font: bold, size: 7.5, color: blue });
    lines.forEach((text, index) => page.drawText(text, { x: 160, y: y - 17 - index * 12, font: regular, size: 9, color: navy }));
    page.drawLine({ start: { x: margin, y: y - rowHeight }, end: { x: width - margin, y: y - rowHeight }, thickness: 0.55, color: divider });
    y -= rowHeight;
  };
  const paragraph = (text: string, size = 9): void => {
    const lines = wrap(regular, text || "Not supplied.", size, width - margin * 2 - 20);
    const lineHeight = size + 3.2;
    ensure(lines.length * lineHeight + 16);
    lines.forEach((content, index) => page.drawText(content, { x: margin + 10, y: y - 12 - index * lineHeight, font: regular, size, color: navy }));
    y -= lines.length * lineHeight + 16;
  };

  addPage(false);
  page.drawText("NOT A QUOTATION, INVOICE, OFFER, OR CONTRACT", { x: margin, y: 699, font: bold, size: 8.5, color: gold });
  y = 674;
  section("Application details");
  row("Applicant", `${data.contact.name}${data.contact.company ? ` - ${data.contact.company}` : ""}`, paleBlue);
  row("Contact", `${data.contact.email} | ${data.contact.phone} | ${titleCase(data.contact.preferredContact)}`);
  row("Project", `${titleCase(data.project.classification)} - ${titleCase(data.project.projectType)} | ${data.project.floors} floor(s)`, paleBlue);
  row("Site", `${data.project.siteAddress}, ${data.project.parish}`);
  row("Stage and condition", `${data.project.stage || "Not supplied"} | ${data.project.buildStatus || "Not supplied"}`, paleBlue);

  section("Area and planning fee");
  row("Fee-bearing area", `${data.project.squareFeet.toLocaleString()} sq. ft.`, paleGold);
  row("Circulation excluded", `${Number(data.project.circulationSquareFeet || 0).toLocaleString()} sq. ft. - halls, corridors, stairs, landings, and connector spaces`);
  row("Base design fee", money(totals.base, totals.displayCurrency), paleGold);
  row("Configured add-ons", money(totals.addOns, totals.displayCurrency));
  row("Preliminary range", `${money(totals.low, totals.displayCurrency)} - ${money(totals.high, totals.displayCurrency)}`, paleGold);
  row("Pricing snapshot", `${pricing.version} | USD/JMD ${pricing.usdToJmd} | ${pricing.exchangeRateAsOf}`);

  section("Space schedule");
  const schedule = data.project.areaSchedule ?? [];
  if (!schedule.length) paragraph("No detailed area schedule supplied.");
  schedule.forEach((space, index) => row(space.label || titleCase(space.id), `${Number(space.squareFeet || 0).toLocaleString()} sq. ft.`, index % 2 ? undefined : paleBlue));
  section("Requested services");
  paragraph(data.project.services.map(titleCase).join(" | ") || "No services selected.");
  section("Project intent");
  paragraph(data.project.scope);
  section("Architecture and interior direction");
  paragraph(data.project.style || "No style references supplied.");
  section("Timing and budget");
  row("Desired start", data.project.desiredStart || "Not specified", paleBlue);
  row("Target completion", data.project.targetCompletion || "Not specified");
  row("Construction budget", data.project.budgetRange || "Not specified", paleBlue);
  section("Additional notes and documents");
  paragraph(data.project.notes || "No additional notes supplied.");
  paragraph(data.attachments.length ? data.attachments.map(item => item.name).join(" | ") : "No supporting documents attached.");
  section("Important exclusions and next steps");
  paragraph("This preliminary planning estimate is generated from applicant-supplied information and a locked pricing snapshot. Circulation space is recorded for planning but excluded from the live fee basis. Site investigation, statutory fees, specialist studies, engineering certification, revisions, construction costs, and services not expressly priced are excluded. Gerardo Faustin Designs will verify the scope, measurements, site conditions, consultant requirements, deliverables, and final fee before issuing any formal quotation.", 8.5);

  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 55 }, end: { x: width - margin, y: 55 }, thickness: 0.6, color: divider });
    item.drawText("Gerardo Faustin Designs Limited", { x: margin, y: 38, font: bold, size: 8, color: navy });
    item.drawText("gerardofaustindesigns@gmail.com | WhatsApp +1 876 805 6385", { x: margin, y: 25, font: regular, size: 7.5, color: gray });
    item.drawText(`Page ${index + 1} of ${pages.length}`, { x: 520, y: 31, font: regular, size: 7.5, color: gray });
  });
  document.setTitle(`${reference} Preliminary Estimate`);
  document.setAuthor("Gerardo Faustin Designs Limited");
  document.setSubject("Preliminary project estimate - not a formal quotation or invoice");
  return document.save();
}
