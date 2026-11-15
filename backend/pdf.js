const fs = require("fs");
const crypto = require("crypto");
const { PDFDocument, rgb, StandardFonts, degrees } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  );
}

const NAVY = hexToRgb("0B1F3A");
const GOLD = hexToRgb("C9A227");
const MUTED = hexToRgb("5A6577");
const INK = rgb(0.08, 0.12, 0.22);

// Hebrew, Arabic and their presentation forms.
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ]/;

function clean(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]+/g, " ")
    .trim();
}

function loadFontFile(name) {
  try {
    return fs.readFileSync(require.resolve(`dejavu-fonts-ttf/ttf/${name}`));
  } catch {
    return null;
  }
}

/**
 * Text drawing that never throws on characters the built-in PDF fonts cannot
 * encode. Plain Latin text keeps using Helvetica. Anything else (Arabic,
 * Cyrillic, Greek, symbols...) falls back to an embedded Unicode font, with
 * right-to-left runs laid out in visual order.
 */
async function createTextKit(pdf) {
  pdf.registerFontkit(fontkit);
  const standard = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const unicode = {};

  async function unicodeFont(style) {
    const key = style === "bold" ? "bold" : "regular";
    if (unicode[key] === undefined) {
      const bytes = loadFontFile(key === "bold" ? "DejaVuSans-Bold.ttf" : "DejaVuSans.ttf");
      unicode[key] = bytes ? await pdf.embedFont(bytes, { subset: true }) : null;
    }
    return unicode[key];
  }

  function encodable(font, text) {
    try {
      font.encodeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // A small bidi pass: strong characters set a direction, and spaces or
  // punctuation take the direction of their neighbours when those agree,
  // otherwise the direction of the line.
  function splitRuns(text, baseDir) {
    const chars = [...text];
    const dirs = chars.map((ch) => (RTL_CHAR.test(ch) ? "rtl" : LTR_CHAR.test(ch) ? "ltr" : null));
    const resolved = dirs.slice();
    for (let i = 0; i < chars.length; i++) {
      if (dirs[i]) continue;
      let prev = null;
      let next = null;
      for (let j = i - 1; j >= 0 && !prev; j--) prev = dirs[j];
      for (let j = i + 1; j < chars.length && !next; j++) next = dirs[j];
      resolved[i] = prev && prev === next ? prev : baseDir;
    }
    const runs = [];
    chars.forEach((ch, i) => {
      const last = runs[runs.length - 1];
      if (last && last.dir === resolved[i]) last.text += ch;
      else runs.push({ dir: resolved[i], text: ch });
    });
    return runs;
  }

  // Returns the pieces to draw left to right, each with its own font.
  // `dir` is the direction of the line: "auto" follows the first letter.
  async function layout(raw, style, dir = "auto") {
    const text = clean(raw);
    if (!text) return [];
    const base = standard[style] || standard.regular;
    if (encodable(base, text)) return [{ text, font: base }];
    const font = await unicodeFont(style);
    if (!font) {
      // No Unicode font available: keep what Helvetica can draw.
      const safe = [...text].map((ch) => (encodable(base, ch) ? ch : "?")).join("");
      return [{ text: safe, font: base }];
    }
    let baseDir = dir;
    if (baseDir !== "ltr" && baseDir !== "rtl") {
      const firstStrong = [...text].find((ch) => RTL_CHAR.test(ch) || LTR_CHAR.test(ch));
      baseDir = firstStrong && RTL_CHAR.test(firstStrong) ? "rtl" : "ltr";
    }
    const runs = splitRuns(text, baseDir);
    if (baseDir === "rtl") runs.reverse();
    return runs.map((run) => ({ text: run.text, font }));
  }

  function widthOf(pieces, size) {
    return pieces.reduce((sum, p) => sum + p.font.widthOfTextAtSize(p.text, size), 0);
  }

  async function measure(text, style, size, dir) {
    return widthOf(await layout(text, style, dir), size);
  }

  // Shortens text with an ellipsis until it fits maxWidth at this size.
  async function truncate(text, style, size, maxWidth, dir) {
    let value = clean(text);
    if ((await measure(value, style, size, dir)) <= maxWidth) return value;
    const chars = [...value];
    while (chars.length > 1) {
      chars.pop();
      value = chars.join("").trimEnd() + "...";
      if ((await measure(value, style, size, dir)) <= maxWidth) return value;
    }
    return value;
  }

  // Greedy word wrap that works for any script.
  async function wrap(text, style, size, maxWidth, dir) {
    const words = clean(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || (await measure(next, style, size, dir)) <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    const out = [];
    for (const l of lines) out.push(await truncate(l, style, size, maxWidth, dir));
    return out;
  }

  /**
   * Draws one line. `toPage` maps upright display coordinates to page
   * coordinates and `angle` is the page rotation, so text stays upright on
   * rotated pages.
   */
  async function draw(page, text, { x, y, size, style = "regular", color = INK, toPage, angle = 0, dir }) {
    const pieces = await layout(text, style, dir);
    let cursor = x;
    for (const piece of pieces) {
      const at = toPage ? toPage(cursor, y) : { x: cursor, y };
      page.drawText(piece.text, {
        x: at.x,
        y: at.y,
        size,
        font: piece.font,
        color,
        rotate: degrees(angle),
      });
      cursor += piece.font.widthOfTextAtSize(piece.text, size);
    }
    return cursor - x;
  }

  return { draw, measure, truncate, wrap };
}

/**
 * The viewer shows each page's crop box, rotated by the page's /Rotate
 * value. Fields are stored as percentages of that upright view, so map them
 * back into the page's own coordinate system before drawing.
 */
function pageGeometry(page) {
  const box = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  function toPage(x, y) {
    if (angle === 90) return { x: box.x + height - y, y: box.y + x };
    if (angle === 180) return { x: box.x + width - x, y: box.y + height - y };
    if (angle === 270) return { x: box.x + y, y: box.y + width - x };
    return { x: box.x + x, y: box.y + y };
  }
  return { width, height, angle, toPage };
}

async function embedImage(pdf, dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (!bytes.length) return null;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    return isJpeg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function stampEnvelope(envelope, originalPath, outputPath) {
  const bytes = fs.readFileSync(originalPath);
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  const kit = await createTextKit(pdf);

  const filled = envelope.fields.filter((f) => typeof f.value === "string" && f.value.length > 0);

  for (const field of filled) {
    const pageIndex = Math.max(0, Math.min((Number(field.page) || 1) - 1, pages.length - 1));
    const page = pages[pageIndex];
    const geo = pageGeometry(page);
    const w = (field.w / 100) * geo.width;
    const h = (field.h / 100) * geo.height;
    const x = (field.x / 100) * geo.width;
    const y = geo.height - (field.y / 100) * geo.height - h;
    const isImageField = field.type === "signature" || field.type === "initials";

    if (isImageField && field.value.startsWith("data:image")) {
      const img = await embedImage(pdf, field.value);
      if (!img) continue;
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const at = geo.toPage(x + (w - dw) / 2, y + (h - dh) / 2);
      page.drawImage(img, { x: at.x, y: at.y, width: dw, height: dh, rotate: degrees(geo.angle) });
    } else if (field.type === "checkbox") {
      const side = Math.min(w, h);
      const corner = geo.toPage(x, y);
      page.drawRectangle({
        x: corner.x,
        y: corner.y,
        width: side,
        height: side,
        borderColor: INK,
        borderWidth: 1.2,
        color: rgb(1, 1, 1),
        rotate: degrees(geo.angle),
      });
      if (field.value.toLowerCase() === "yes") {
        const pad = side * 0.22;
        const thickness = Math.max(1.2, side * 0.12);
        page.drawLine({
          start: geo.toPage(x + pad, y + pad),
          end: geo.toPage(x + side - pad, y + side - pad),
          thickness,
          color: INK,
        });
        page.drawLine({
          start: geo.toPage(x + pad, y + side - pad),
          end: geo.toPage(x + side - pad, y + pad),
          thickness,
          color: INK,
        });
      }
    } else {
      const style = field.type === "name" ? "italic" : "regular";
      const maxWidth = Math.max(10, w - 8);
      let size = Math.max(8, Math.min(14, h * 0.55));
      // Shrink to fit the box before giving up and shortening the text.
      while (size > 6 && (await kit.measure(field.value, style, size)) > maxWidth) size -= 0.5;
      const text = await kit.truncate(field.value, style, size, maxWidth);
      await kit.draw(page, text, {
        x: x + 4,
        y: y + Math.max(2, (h - size) / 2 + size * 0.2),
        size,
        style,
        toPage: geo.toPage,
        angle: geo.angle,
      });
    }
  }

  await drawCertificate(pdf, kit, envelope, sha256(bytes));

  const out = await pdf.save();
  const tmp = `${outputPath}.tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, outputPath);
}

async function drawCertificate(pdf, kit, envelope, originalHash) {
  const W = 612;
  const H = 792;
  const LEFT = 48;
  const RIGHT = W - 48;
  const BOTTOM = 64;
  let page;
  let y;
  let pageNo = 0;

  async function newPage() {
    page = pdf.addPage([W, H]);
    pageNo += 1;
    page.drawRectangle({ x: 0, y: H - 88, width: W, height: 88, color: NAVY });
    page.drawRectangle({ x: 0, y: H - 92, width: W, height: 4, color: GOLD });
    await kit.draw(page, "DOCYSIGN", { x: LEFT, y: H - 42, size: 18, style: "bold", color: GOLD });
    await kit.draw(page, pageNo === 1 ? "Certificate of Completion" : "Certificate of Completion (continued)", {
      x: LEFT,
      y: H - 68,
      size: 14,
      color: rgb(1, 1, 1),
    });
    page.drawRectangle({ x: 0, y: 0, width: W, height: 36, color: NAVY });
    await kit.draw(
      page,
      "This document was signed electronically with DocySign. Signatures are legally binding under applicable e-sign laws.",
      { x: LEFT, y: 14, size: 8, color: rgb(0.85, 0.88, 0.92) }
    );
    y = H - 132;
  }

  async function need(space) {
    if (y - space < BOTTOM) await newPage();
  }

  // Certificate lines are English labels around user text, so they read left
  // to right even when a name or title inside them is Arabic or Hebrew.
  async function line(text, { size = 10, style = "regular", color = NAVY, gap = 6, indent = 0, dir = "ltr" } = {}) {
    const lines = await kit.wrap(text, style, size, RIGHT - LEFT - indent, dir);
    for (let i = 0; i < lines.length; i++) {
      const last = i === lines.length - 1;
      await need(size + gap);
      await kit.draw(page, lines[i], { x: LEFT + indent, y, size, style, color, dir });
      y -= size + (last ? gap : 4);
    }
  }

  async function heading(text) {
    await need(60);
    y -= 12;
    await line(text, { size: 12, style: "bold", gap: 12 });
  }

  await newPage();
  await line("Document", { size: 10, style: "bold", color: MUTED, gap: 10 });
  await line(envelope.title || "Untitled", { size: 16, style: "bold", gap: 10, dir: "auto" });
  await line(`Envelope ID: ${envelope.id}`, { size: 9, color: MUTED });
  await line(`File: ${envelope.fileName || "document.pdf"}`, { size: 9, color: MUTED });
  await line(`Completed: ${new Date(envelope.completedAt || Date.now()).toUTCString()}`, { size: 9, color: MUTED });
  await line(`Original document SHA-256: ${originalHash}`, { size: 8, color: MUTED });

  await heading("Signers");
  const ordered = [...(envelope.signers || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const s of ordered) {
    await need(46);
    await line(`${s.name || s.email}  <${s.email}>`, { size: 10, style: "bold", gap: 4 });
    const verb = s.role === "approver" ? "Approved" : "Signed";
    const when = s.signedAt ? new Date(s.signedAt).toUTCString() : "not recorded";
    const origin = s.signedIp ? `  |  IP ${s.signedIp}` : "";
    await line(`${verb}: ${when}${origin}`, { size: 9, color: MUTED, gap: 12 });
  }

  await heading("Audit trail");
  for (const event of envelope.audit || []) {
    await need(40);
    await line(new Date(event.at).toUTCString(), { size: 8, color: MUTED, gap: 4 });
    await line(`${event.actor} - ${event.action}`, { size: 10, gap: 12 });
  }
}

/** Throws a readable error unless the file is a PDF we will be able to stamp later. */
async function inspectPdf(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.subarray(0, 1024).indexOf("%PDF-") < 0) {
    throw new Error("That file is not a PDF");
  }
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (err) {
    if (/encrypted/i.test(err.message)) {
      throw new Error("This PDF is password-protected. Remove the protection and upload it again.");
    }
    throw new Error("This PDF could not be read. It may be damaged.");
  }
  const pageCount = pdf.getPageCount();
  if (!pageCount) throw new Error("This PDF has no pages");
  return { pageCount };
}

async function createSampleContract() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const { width, height } = page.getSize();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: NAVY });
  page.drawRectangle({ x: 0, y: height - 74, width, height: 4, color: GOLD });
  page.drawText("DOCYSIGN", { x: 48, y: height - 42, size: 14, font: fontBold, color: GOLD });
  page.drawText("MUTUAL NON-DISCLOSURE AGREEMENT", {
    x: 48,
    y: height - 120,
    size: 16,
    font: fontBold,
    color: NAVY,
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
    page.drawText(line, { x: 48, y, size: 10, font, color: MUTED });
    y -= 16;
  }

  page.drawText("Team member / first party", { x: 48, y: 220, size: 10, font: fontBold, color: NAVY });
  page.drawLine({ start: { x: 48, y: 188 }, end: { x: 260, y: 188 }, thickness: 1, color: NAVY });
  page.drawText("Signature", { x: 48, y: 174, size: 8, font, color: MUTED });
  page.drawLine({ start: { x: 48, y: 148 }, end: { x: 260, y: 148 }, thickness: 1, color: NAVY });
  page.drawText("Printed name / date", { x: 48, y: 134, size: 8, font, color: MUTED });

  page.drawText("Manager / second party", { x: 320, y: 220, size: 10, font: fontBold, color: NAVY });
  page.drawLine({ start: { x: 320, y: 188 }, end: { x: 532, y: 188 }, thickness: 1, color: NAVY });
  page.drawText("Signature", { x: 320, y: 174, size: 8, font, color: MUTED });
  page.drawLine({ start: { x: 320, y: 148 }, end: { x: 532, y: 148 }, thickness: 1, color: NAVY });
  page.drawText("Printed name / date", { x: 320, y: 134, size: 8, font, color: MUTED });

  return Buffer.from(await pdf.save());
}

module.exports = { stampEnvelope, createSampleContract, inspectPdf };
