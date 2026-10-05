const fs = require("fs");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
}

async function stampEnvelope(envelope, originalPath, outputPath) {
  const bytes = fs.readFileSync(originalPath);
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const signedFields = envelope.fields.filter(
    (f) => f.value && f.value.length > 0
  );

  for (const field of signedFields) {
    const pageIndex = Math.max(0, Math.min(field.page - 1, pages.length - 1));
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const x = (field.x / 100) * width;
    const y = height - (field.y / 100) * height - (field.h / 100) * height;
    const w = (field.w / 100) * width;
    const h = (field.h / 100) * height;

    if (field.type === "signature" && field.value.startsWith("data:image")) {
      const base64 = field.value.split(",")[1];
      const imgBytes = Buffer.from(base64, "base64");
      let img;
      try {
        img = await pdf.embedPng(imgBytes);
      } catch {
        img = await pdf.embedJpg(imgBytes);
      }
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      page.drawImage(img, {
        x: x + (w - dw) / 2,
        y: y + (h - dh) / 2,
        width: dw,
        height: dh,
      });
    } else if (field.type === "initials" && field.value.startsWith("data:image")) {
      const base64 = field.value.split(",")[1];
      const imgBytes = Buffer.from(base64, "base64");
      let img;
      try {
        img = await pdf.embedPng(imgBytes);
      } catch {
        img = await pdf.embedJpg(imgBytes);
      }
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      page.drawImage(img, {
        x: x + (w - dw) / 2,
        y: y + (h - dh) / 2,
        width: dw,
        height: dh,
      });
    } else if (field.type === "checkbox") {
      const on = String(field.value).toLowerCase() === "yes" || field.value === true;
      page.drawRectangle({
        x,
        y,
        width: Math.min(w, h),
        height: Math.min(w, h),
        borderColor: rgb(0.08, 0.12, 0.22),
        borderWidth: 1.2,
        color: rgb(1, 1, 1),
      });
      if (on) {
        const size = Math.max(8, Math.min(w, h) * 0.75);
        page.drawText("X", {
          x: x + Math.min(w, h) * 0.22,
          y: y + Math.min(w, h) * 0.18,
          size,
          font: fontBold,
          color: rgb(0.08, 0.12, 0.22),
        });
      }
    } else {
      const text = String(field.value || "");
      const size = Math.max(8, Math.min(14, h * 0.55));
      page.drawText(text, {
        x: x + 4,
        y: y + h * 0.28,
        size,
        font: field.type === "name" ? italic : font,
        color: rgb(0.08, 0.12, 0.22),
        maxWidth: w - 8,
      });
    }
  }

  const cert = pdf.addPage();
  const { width: cw, height: ch } = cert.getSize();
  const navy = hexToRgb("0B1F3A");
  const gold = hexToRgb("C9A227");
  const muted = hexToRgb("5A6577");

  cert.drawRectangle({ x: 0, y: ch - 88, width: cw, height: 88, color: navy });
  cert.drawRectangle({ x: 0, y: ch - 92, width: cw, height: 4, color: gold });
  cert.drawText("DOCYSIGN", {
    x: 48,
    y: ch - 42,
    size: 18,
    font: fontBold,
    color: gold,
  });
  cert.drawText("Certificate of Completion", {
    x: 48,
    y: ch - 68,
    size: 14,
    font: font,
    color: rgb(1, 1, 1),
  });

  cert.drawText("Document", {
    x: 48,
    y: ch - 140,
    size: 10,
    font: fontBold,
    color: muted,
  });
  cert.drawText(envelope.title || "Untitled", {
    x: 48,
    y: ch - 160,
    size: 16,
    font: fontBold,
    color: navy,
  });

  cert.drawText(`Envelope ID: ${envelope.id}`, {
    x: 48,
    y: ch - 186,
    size: 9,
    font: font,
    color: muted,
  });
  cert.drawText(
    `Completed: ${new Date(envelope.completedAt || Date.now()).toUTCString()}`,
    {
      x: 48,
      y: ch - 202,
      size: 9,
      font: font,
      color: muted,
    }
  );

  let rowY = ch - 250;
  cert.drawText("Audit trail", {
    x: 48,
    y: rowY,
    size: 12,
    font: fontBold,
    color: navy,
  });
  rowY -= 28;

  for (const event of envelope.audit || []) {
    if (rowY < 80) break;
    cert.drawText(new Date(event.at).toUTCString(), {
      x: 48,
      y: rowY,
      size: 8,
      font: font,
      color: muted,
    });
    cert.drawText(`${event.actor} — ${event.action}`, {
      x: 48,
      y: rowY - 14,
      size: 10,
      font: font,
      color: navy,
    });
    rowY -= 40;
  }

  cert.drawRectangle({ x: 0, y: 0, width: cw, height: 36, color: navy });
  cert.drawText(
    "This document was signed electronically with DocySign. Signatures are legally binding under applicable e-sign laws.",
    {
      x: 48,
      y: 14,
      size: 8,
      font: font,
      color: rgb(0.85, 0.88, 0.92),
    }
  );

  const out = await pdf.save();
  fs.writeFileSync(outputPath, out);
}

async function createSampleContract() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = hexToRgb("0B1F3A");
  const gold = hexToRgb("C9A227");
  const muted = hexToRgb("5A6577");

  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: navy });
  page.drawRectangle({ x: 0, y: height - 74, width, height: 4, color: gold });
  page.drawText("DOCYSIGN", { x: 48, y: height - 42, size: 14, font: fontBold, color: gold });
  page.drawText("MUTUAL NON-DISCLOSURE AGREEMENT", {
    x: 48,
    y: height - 120,
    size: 16,
    font: fontBold,
    color: navy,
  });

  const body = [
    "This Mutual Non-Disclosure Agreement (the \"Agreement\") is entered into by the",
    "parties identified below for the purpose of protecting confidential information",
    "shared in connection with a potential business relationship.",
    "",
    "1. Confidential Information. Each party may disclose proprietary information,",
    "including business plans, customer data, technical materials, and financials.",
    "",
    "2. Obligations. The receiving party shall not disclose Confidential Information",
    "to third parties and shall use it solely to evaluate the contemplated relationship.",
    "",
    "3. Term. The duties in this Agreement survive for three (3) years from the date",
    "of last disclosure, except for trade secrets, which remain protected while secret.",
    "",
    "4. Electronic Signatures. The parties agree that electronic signatures on this",
    "document are valid, enforceable, and have the same effect as wet-ink signatures.",
    "",
    "IN WITNESS WHEREOF, the parties have executed this Agreement as of the dates",
    "written below their signatures.",
  ];
  let y = height - 160;
  for (const line of body) {
    page.drawText(line, { x: 48, y, size: 10, font, color: muted });
    y -= 16;
  }

  page.drawText("Team member / first party", { x: 48, y: 220, size: 10, font: fontBold, color: navy });
  page.drawLine({ start: { x: 48, y: 188 }, end: { x: 260, y: 188 }, thickness: 1, color: navy });
  page.drawText("Signature", { x: 48, y: 174, size: 8, font, color: muted });
  page.drawLine({ start: { x: 48, y: 148 }, end: { x: 260, y: 148 }, thickness: 1, color: navy });
  page.drawText("Printed name / date", { x: 48, y: 134, size: 8, font, color: muted });

  page.drawText("Manager / second party", { x: 320, y: 220, size: 10, font: fontBold, color: navy });
  page.drawLine({ start: { x: 320, y: 188 }, end: { x: 532, y: 188 }, thickness: 1, color: navy });
  page.drawText("Signature", { x: 320, y: 174, size: 8, font, color: muted });
  page.drawLine({ start: { x: 320, y: 148 }, end: { x: 532, y: 148 }, thickness: 1, color: navy });
  page.drawText("Printed name / date", { x: 320, y: 134, size: 8, font, color: muted });

  return Buffer.from(await pdf.save());
}

module.exports = { stampEnvelope, createSampleContract };
