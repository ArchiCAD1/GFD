const PDF_LIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

const clean = value => String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
const titleCase = value => clean(value).replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, letter => letter.toUpperCase());

function wrapText(font, text, size, maxWidth) {
  const words = clean(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function createPreliminaryEstimatePDF({ reference, payload, estimate, money }) {
  const { PDFDocument, StandardFonts, rgb } = await import(PDF_LIB_URL);
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
  const lineColor = rgb(0.82, 0.84, 0.84);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 38;
  let logo;
  try {
    const logoBytes = await fetch("assets/gerardo-faustin-designs-logo.jpg").then(response => response.arrayBuffer());
    logo = await document.embedJpg(logoBytes);
  } catch { /* The branded text header remains available offline. */ }

  let page;
  let y;
  const pages = [];

  const addPage = continuation => {
    page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: 716, width: pageWidth, height: 76, color: navy });
    page.drawText("GERARDO FAUSTIN", { x: margin, y: 755, font: serif, size: 18, color: rgb(1, 1, 1) });
    page.drawText("DESIGNS LIMITED", { x: margin, y: 735, font: bold, size: 10, color: rgb(0.86, 0.89, 0.93) });
    if (logo) page.drawImage(logo, { x: 278, y: 724, width: 55, height: 55 });
    page.drawText(continuation ? "ESTIMATE - CONTINUED" : "PRELIMINARY ESTIMATE", { x: 378, y: 750, font: bold, size: 11, color: rgb(1, 1, 1) });
    page.drawText(clean(reference || "PREVIEW"), { x: 378, y: 733, font: regular, size: 8.5, color: rgb(0.86, 0.89, 0.93) });
    y = 690;
  };

  const ensureSpace = height => {
    if (y - height < 78) addPage(true);
  };

  const sectionTitle = text => {
    ensureSpace(70);
    page.drawRectangle({ x: margin, y: y - 21, width: pageWidth - margin * 2, height: 24, color: blue });
    page.drawText(clean(text).toUpperCase(), { x: margin + 10, y: y - 14, font: bold, size: 9, color: rgb(1, 1, 1) });
    y -= 31;
  };

  const infoRow = (label, value, fill) => {
    const valueLines = wrapText(regular, value || "-", 9, 390);
    const height = Math.max(28, valueLines.length * 12 + 12);
    ensureSpace(height);
    if (fill) page.drawRectangle({ x: margin, y: y - height, width: pageWidth - margin * 2, height, color: fill });
    page.drawText(clean(label).toUpperCase(), { x: margin + 10, y: y - 17, font: bold, size: 7.5, color: blue });
    valueLines.forEach((text, index) => page.drawText(text, { x: 160, y: y - 17 - index * 12, font: regular, size: 9, color: navy }));
    page.drawLine({ start: { x: margin, y: y - height }, end: { x: pageWidth - margin, y: y - height }, thickness: 0.55, color: lineColor });
    y -= height;
  };

  const paragraph = (text, options = {}) => {
    const size = options.size || 9;
    const lines = wrapText(options.font || regular, text || "Not supplied.", size, pageWidth - margin * 2 - 20);
    const lineHeight = size + 3.2;
    ensureSpace(lines.length * lineHeight + 16);
    lines.forEach((content, index) => page.drawText(content, { x: margin + 10, y: y - 12 - index * lineHeight, font: options.font || regular, size, color: options.color || navy }));
    y -= lines.length * lineHeight + 16;
  };

  addPage(false);
  page.drawText("NOT A QUOTATION, INVOICE, OFFER, OR CONTRACT", { x: margin, y: 699, font: bold, size: 8.5, color: gold });
  y = 674;

  const contact = payload.contact || {};
  const project = payload.project || {};
  sectionTitle("Application details");
  infoRow("Applicant", `${contact.name || "-"}${contact.company ? ` - ${contact.company}` : ""}`, paleBlue);
  infoRow("Contact", `${contact.email || "-"} | ${contact.phone || "-"} | ${titleCase(contact.preferredContact || "email")}`);
  infoRow("Project", `${titleCase(project.classification)} - ${titleCase(project.projectType)} | ${project.floors || 1} floor(s)`, paleBlue);
  infoRow("Site", `${project.siteAddress || "-"}, ${project.parish || "-"}`);
  infoRow("Stage and condition", `${project.stage || "-"} | ${project.buildStatus || "-"}`, paleBlue);

  sectionTitle("Area and planning fee");
  const feeArea = Number(project.chargeableSquareFeet ?? project.squareFeet ?? 0);
  infoRow("Fee-bearing area", `${feeArea.toLocaleString()} sq. ft.`, paleGold);
  infoRow("Circulation excluded", `${Number(project.circulationSquareFeet || 0).toLocaleString()} sq. ft. - halls, corridors, stairs, landings, and connector spaces`);
  if (estimate?.complete) {
    infoRow("Base design fee", money(estimate.base, estimate.currency), paleGold);
    infoRow("Configured add-ons", money(estimate.additions || 0, estimate.currency));
    infoRow("Preliminary range", `${money(estimate.low, estimate.currency)} - ${money(estimate.high, estimate.currency)}`, paleGold);
  } else infoRow("Planning fee", "Pricing configuration incomplete - manual review required", paleGold);

  sectionTitle("Space schedule");
  const schedule = Array.isArray(project.areaSchedule) ? project.areaSchedule : [];
  if (!schedule.length) paragraph("No detailed area schedule supplied.");
  schedule.forEach((space, index) => infoRow(space.label || titleCase(space.id), `${Number(space.squareFeet || 0).toLocaleString()} sq. ft.`, index % 2 ? undefined : paleBlue));

  sectionTitle("Requested services");
  paragraph((project.services || []).map(titleCase).join(" | ") || "No services selected.");
  sectionTitle("Project intent");
  paragraph(project.scope);
  sectionTitle("Architecture and interior direction");
  paragraph(project.style || "No style references supplied.");
  sectionTitle("Timing and budget");
  infoRow("Desired start", project.desiredStart || "Not specified", paleBlue);
  infoRow("Target completion", project.targetCompletion || "Not specified");
  infoRow("Construction budget", project.budgetRange || "Not specified", paleBlue);

  sectionTitle("Additional notes and documents");
  paragraph(project.notes || "No additional notes supplied.");
  const attachments = payload.attachments || [];
  paragraph(attachments.length ? attachments.map(item => item.name).join(" | ") : "No supporting documents attached.");

  sectionTitle("Important exclusions and next steps");
  paragraph("This preliminary planning estimate is generated from applicant-supplied information and a locked pricing snapshot. Circulation space is recorded for planning but excluded from the live fee basis. Site investigation, statutory fees, specialist studies, engineering certification, revisions, construction costs, and services not expressly priced are excluded. Gerardo Faustin Designs will verify the scope, measurements, site conditions, consultant requirements, deliverables, and final fee before issuing any formal quotation.", { size: 8.5 });

  pages.forEach((currentPage, index) => {
    currentPage.drawLine({ start: { x: margin, y: 55 }, end: { x: pageWidth - margin, y: 55 }, thickness: 0.6, color: lineColor });
    currentPage.drawText("Gerardo Faustin Designs Limited", { x: margin, y: 38, font: bold, size: 8, color: navy });
    currentPage.drawText("gerardofaustindesigns@gmail.com | WhatsApp +1 876 805 6385", { x: margin, y: 25, font: regular, size: 7.5, color: gray });
    currentPage.drawText(`Page ${index + 1} of ${pages.length}`, { x: 520, y: 31, font: regular, size: 7.5, color: gray });
  });

  document.setTitle(`${reference || "GFD"} Preliminary Estimate`);
  document.setAuthor("Gerardo Faustin Designs Limited");
  document.setSubject("Preliminary project estimate - not a formal quotation or invoice");
  return new Blob([await document.save()], { type: "application/pdf" });
}
