const ascii = value => String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "-");
const pdfText = value => ascii(value).replace(/([\\()])/g, "\\$1");

function wrap(text, width = 84) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width) { lines.push(line); line = word; }
    else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export function createPreliminaryEstimatePDF({ reference, payload, estimate, money }) {
  const contact = payload.contact;
  const project = payload.project;
  const lines = [
    ["APPLICATION", reference || "PREVIEW"],
    ["APPLICANT", `${contact.name}${contact.company ? ` - ${contact.company}` : ""}`],
    ["CONTACT", `${contact.email} - ${contact.phone}`],
    ["PROJECT", `${project.classification} - ${project.projectType}`],
    ["SITE", `${project.siteAddress}, ${project.parish}`],
    ["AREA", `${Number(project.squareFeet).toLocaleString()} sq. ft. - ${project.floors} floor(s)`]
  ];
  if (estimate?.complete) {
    lines.push(["BASE", money(estimate.base, estimate.currency)]);
    lines.push(["ADD-ONS", money(estimate.additions, estimate.currency)]);
    lines.push(["PLANNING RANGE", `${money(estimate.low, estimate.currency)} - ${money(estimate.high, estimate.currency)}`]);
  } else lines.push(["PRICING", "Incomplete configuration - manual review required"]);

  const commands = [
    "0.075 0.145 0.24 rg 0 734 612 58 re f",
    "BT /F2 15 Tf 1 1 1 rg 38 758 Td (GERARDO FAUSTIN DESIGNS) Tj ET",
    "BT /F2 21 Tf 0.075 0.145 0.24 rg 38 700 Td (PRELIMINARY PROJECT ESTIMATE) Tj ET",
    "BT /F2 9 Tf 0.69 0.52 0.2 rg 38 680 Td (NOT A FORMAL QUOTATION OR INVOICE) Tj ET"
  ];
  let y = 638;
  for (const [label, value] of lines) {
    commands.push(`BT /F2 8 Tf 0.69 0.52 0.2 rg 38 ${y} Td (${pdfText(label)}) Tj ET`);
    commands.push(`BT /F1 10 Tf 0.075 0.145 0.24 rg 168 ${y} Td (${pdfText(value).slice(0, 92)}) Tj ET`);
    commands.push(`0.82 0.84 0.82 RG 0.5 w 38 ${y - 10} m 574 ${y - 10} l S`);
    y -= 34;
  }
  commands.push(`BT /F2 12 Tf 0.075 0.145 0.24 rg 38 ${y - 2} Td (PROJECT INTENT) Tj ET`);
  for (const [index, line] of wrap(project.scope, 94).slice(0, 12).entries()) {
    commands.push(`BT /F1 9 Tf 0.075 0.145 0.24 rg 38 ${y - 25 - index * 14} Td (${pdfText(line)}) Tj ET`);
  }
  const disclaimer = "This preliminary planning estimate is generated from applicant-supplied information and a pricing snapshot. It is not a quotation, invoice, offer, or contract. Final fees require owner review, verified scope, site conditions, consultant requirements, statutory obligations, exclusions, and deliverables.";
  for (const [index, line] of wrap(disclaimer, 105).entries()) commands.push(`BT /F1 7.5 Tf 0.075 0.145 0.24 rg 38 ${58 - index * 10} Td (${pdfText(line)}) Tj ET`);
  const stream = `${commands.join("\n")}\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { document += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([document], { type: "application/pdf" });
}
