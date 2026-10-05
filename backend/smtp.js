const fs = require("fs");
const nodemailer = require("nodemailer");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function envSettings() {
  if (!process.env.SMTP_HOST && !process.env.SMTP_USER) return null;
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "DocySign",
    fromEmail: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  };
}

function isConfigured(settings) {
  return !!(settings && settings.host && settings.user && settings.pass);
}

function publicSettings(settings) {
  if (!settings) {
    return {
      configured: false,
      host: "",
      port: 587,
      secure: false,
      user: "",
      fromName: "DocySign",
      fromEmail: "",
      hasPassword: false,
    };
  }
  return {
    configured: isConfigured(settings),
    host: settings.host || "",
    port: settings.port || 587,
    secure: !!settings.secure,
    user: settings.user || "",
    fromName: settings.fromName || "DocySign",
    fromEmail: settings.fromEmail || settings.user || "",
    hasPassword: !!settings.pass,
  };
}

function wrapHtml({
  title,
  intro,
  greeting,
  body,
  details,
  ctaLabel,
  ctaHref,
  footer,
}) {
  const detailRows = (details || [])
    .filter((d) => d && d.value)
    .map((d) => `<tr>
      <td style="padding:8px 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6a6a6a;font-weight:600;width:140px;vertical-align:top;">${d.label}</td>
      <td style="padding:8px 0;font-size:15px;color:#0a0a0a;line-height:1.45;">${d.value}</td>
    </tr>`)
    .join("");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;background:#f4efe4;font-family:Georgia,'Times New Roman',Times,serif;color:#3a3a3a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe4;padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:0 8px 16px;">
              <span style="display:inline-block;background:#0a0a0a;color:#fffaf0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:8px 12px;border-radius:8px;">DocySign</span>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e5e5e5;border-radius:4px;">
                <tr>
                  <td style="height:6px;background:#0a0a0a;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:36px 40px 8px;">
                    <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;color:#6a6a6a;font-weight:700;">${intro}</p>
                    <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;color:#0a0a0a;font-weight:normal;letter-spacing:-0.02em;">${title}</h1>
                    ${greeting ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1a1a1a;">${greeting}</p>` : ""}
                    <p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#3a3a3a;">${body}</p>
                  </td>
                </tr>
                ${detailRows ? `<tr>
                  <td style="padding:0 40px 8px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffaf0;border:1px solid #ebe6d6;border-radius:4px;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRows}</table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>` : ""}
                ${ctaHref ? `<tr>
                  <td style="padding:24px 40px 8px;">
                    <a href="${ctaHref}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.02em;">${ctaLabel}</a>
                    <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#9a9a9a;word-break:break-all;">If the button does not work, paste this link into your browser:<br/>${ctaHref}</p>
                  </td>
                </tr>` : ""}
                <tr>
                  <td style="padding:28px 40px 36px;">
                    <p style="margin:0;font-size:15px;line-height:1.6;color:#3a3a3a;">Kind regards,<br/><span style="color:#0a0a0a;">The DocySign team</span></p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 40px;border-top:1px solid #ebe6d6;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;color:#9a9a9a;">
                    ${footer || "This message was sent by DocySign regarding an electronic signature request."}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: Number(settings.port) || 587,
    secure: !!settings.secure || Number(settings.port) === 465,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
    tls: { rejectUnauthorized: false },
  });
}

async function sendMail(settings, { to, toName, subject, html, text, attachments }) {
  if (!isConfigured(settings)) {
    return { sent: false, skipped: true, error: "SMTP is not configured" };
  }
  const transporter = createTransport(settings);
  const fromName = settings.fromName || "DocySign";
  const fromEmail = settings.fromEmail || settings.user;
  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toName ? `"${toName}" <${to}>` : to,
    subject,
    html,
    text,
    attachments,
  });
  return { sent: true, skipped: false };
}

async function sendRequestEmails(settings, { senderName, senderEmail, envelope, origin, signers }) {
  const results = [];
  const targets = signers && signers.length ? signers : envelope.signers;
  for (const signer of targets) {
    const link = `${origin}/sign/${signer.token}`;
    const action = signer.role === "approver" ? "approve" : "sign";
    const html = wrapHtml({
      intro: "Signature requested",
      title: `Please ${action} “${escapeHtml(envelope.title)}”`,
      greeting: `Hello ${escapeHtml(signer.name || "")},`,
      body: `${escapeHtml(senderName)} has sent you a document for electronic ${action === "approve" ? "approval" : "signature"}. Review the PDF, complete the fields assigned to you, and finish when you are ready. An account is not required.`,
      details: [
        { label: "Document", value: escapeHtml(envelope.title) },
        { label: "From", value: `${escapeHtml(senderName)}<br/>${escapeHtml(senderEmail)}` },
        { label: "Requested of", value: `${escapeHtml(signer.name)}<br/>${escapeHtml(signer.email)}` },
        envelope.message ? { label: "Message", value: escapeHtml(envelope.message) } : null,
      ],
      ctaLabel: action === "approve" ? "Review and approve" : "Review and sign",
      ctaHref: link,
      footer: "You can review and sign from this link without creating an account. To keep the document in a workspace later, register with this email address.",
    });
    try {
      const res = await sendMail(settings, {
        to: signer.email,
        toName: signer.name,
        subject: `${senderName} sent you “${envelope.title}” to sign`,
        html,
        text: `${senderName} asked you to ${action} “${envelope.title}”. Open: ${link}`,
      });
      results.push({ email: signer.email, ...res });
    } catch (err) {
      results.push({ email: signer.email, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendCompletedEmails(settings, { envelope, origin, pdfPath, owner }) {
  const recipients = [];
  const seen = new Set();
  for (const s of envelope.signers) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: s.name, email: s.email });
  }
  for (const c of envelope.cc || []) {
    const key = String(c.email || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: c.name, email: c.email });
  }
  if (owner && owner.email && !seen.has(owner.email.toLowerCase())) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  const loginLink = `${origin}/signup`;
  const fileName = (envelope.title || "document").replace(/[^\w.-]+/g, "_") + "_signed.pdf";
  const attachments = [];
  if (pdfPath && fs.existsSync(pdfPath)) {
    attachments.push({
      filename: fileName,
      path: pdfPath,
      contentType: "application/pdf",
    });
  }
  const results = [];
  for (const recipient of recipients) {
    const party = envelope.signers.find((s) => s.email.toLowerCase() === recipient.email.toLowerCase());
    const link = party?.token
      ? `${origin}/sign/${party.token}`
      : `${origin}/signup?email=${encodeURIComponent(recipient.email)}`;
    const html = wrapHtml({
      intro: "Certificate of completion",
      title: `“${escapeHtml(envelope.title)}” is fully executed`,
      greeting: `Hello ${escapeHtml(recipient.name || "")},`,
      body: `All parties have completed signing. The final PDF is attached to this email for your records. You may also open it in DocySign to preview, print, or download a copy.`,
      details: [
        { label: "Document", value: escapeHtml(envelope.title) },
        { label: "Status", value: "Completed" },
        { label: "Your copy", value: "Signed PDF attached" },
      ],
      ctaLabel: "Open completed document",
      ctaHref: link,
      footer: `No account yet? Create one at ${loginLink} using ${escapeHtml(recipient.email)} to keep this file in your workspace.`,
    });
    try {
      const res = await sendMail(settings, {
        to: recipient.email,
        toName: recipient.name,
        subject: `Completed: “${envelope.title}” is fully signed`,
        html,
        text: `All parties signed “${envelope.title}”. Open: ${link}`,
        attachments,
      });
      results.push({ email: recipient.email, ...res });
    } catch (err) {
      results.push({ email: recipient.email, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendReminderEmails(settings, { senderName, senderEmail, envelope, origin, signers }) {
  const results = [];
  const targets = signers && signers.length ? signers : envelope.signers.filter((s) => s.status === "pending");
  for (const signer of targets) {
    const link = `${origin}/sign/${signer.token}`;
    const action = signer.role === "approver" ? "approve" : "sign";
    const html = wrapHtml({
      intro: "Friendly reminder",
      title: `“${escapeHtml(envelope.title)}” is still awaiting your ${action}`,
      greeting: `Hello ${escapeHtml(signer.name || "")},`,
      body: `${escapeHtml(senderName)} asked us to remind you that this document is still waiting on you. Please review and ${action} at your earliest convenience. You may also decline from the signing page.`,
      details: [
        { label: "Document", value: escapeHtml(envelope.title) },
        { label: "From", value: `${escapeHtml(senderName)}<br/>${escapeHtml(senderEmail)}` },
        { label: "Action", value: action === "approve" ? "Approve" : "Sign" },
      ],
      ctaLabel: action === "approve" ? "Review and approve" : "Review and sign",
      ctaHref: link,
      footer: "If you do not intend to sign, open the link and choose Decline. That closes the envelope and notifies every party.",
    });
    try {
      const res = await sendMail(settings, {
        to: signer.email,
        toName: signer.name,
        subject: `Reminder: “${envelope.title}” is still waiting on you`,
        html,
        text: `${senderName} asked you again to ${action} “${envelope.title}”. Open: ${link}`,
      });
      results.push({ email: signer.email, ...res });
    } catch (err) {
      results.push({ email: signer.email, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendDeclinedEmails(settings, { envelope, origin, signer, reason, owner }) {
  const recipients = [];
  const seen = new Set();
  for (const s of envelope.signers) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: s.name, email: s.email });
  }
  for (const c of envelope.cc || []) {
    const key = String(c.email || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: c.name, email: c.email });
  }
  if (owner && owner.email && !seen.has(owner.email.toLowerCase())) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  const results = [];
  for (const recipient of recipients) {
    const html = wrapHtml({
      intro: "Envelope closed",
      title: `“${escapeHtml(envelope.title)}” will not be completed`,
      greeting: `Hello ${escapeHtml(recipient.name || "")},`,
      body: `${escapeHtml(signer.name)} declined to sign this document. The envelope is now closed and no further signatures will be collected.`,
      details: [
        { label: "Document", value: escapeHtml(envelope.title) },
        { label: "Declined by", value: `${escapeHtml(signer.name)}<br/>${escapeHtml(signer.email)}` },
        reason ? { label: "Reason", value: escapeHtml(reason) } : null,
        { label: "Status", value: "Declined" },
      ],
      ctaLabel: "",
      ctaHref: "",
      footer: `This notice was sent to every party on the envelope. Workspace: ${origin}/app`,
    });
    try {
      const res = await sendMail(settings, {
        to: recipient.email,
        toName: recipient.name,
        subject: `Declined: “${envelope.title}” was not signed`,
        html,
        text: `${signer.name} declined “${envelope.title}”.${reason ? ` Reason: ${reason}` : ""}`,
      });
      results.push({ email: recipient.email, ...res });
    } catch (err) {
      results.push({ email: recipient.email, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendVoidedEmails(settings, { envelope, origin, reason, owner, actorName }) {
  const recipients = [];
  const seen = new Set();
  for (const s of envelope.signers) {
    const key = s.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: s.name, email: s.email });
  }
  for (const c of envelope.cc || []) {
    const key = String(c.email || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push({ name: c.name, email: c.email });
  }
  if (owner && owner.email && !seen.has(owner.email.toLowerCase())) {
    recipients.push({ name: owner.name, email: owner.email });
  }
  const results = [];
  for (const recipient of recipients) {
    const html = wrapHtml({
      intro: "Envelope voided",
      title: `“${escapeHtml(envelope.title)}” is no longer open for signature`,
      greeting: `Hello ${escapeHtml(recipient.name || "")},`,
      body: `${escapeHtml(actorName || "The sender")} voided this envelope. No further signatures will be collected.`,
      details: [
        { label: "Document", value: escapeHtml(envelope.title) },
        { label: "Voided by", value: escapeHtml(actorName || "Sender") },
        reason ? { label: "Reason", value: escapeHtml(reason) } : null,
        { label: "Status", value: "Voided" },
      ],
      ctaLabel: "",
      ctaHref: "",
      footer: `This notice was sent to every party on the envelope. Workspace: ${origin}/app`,
    });
    try {
      const res = await sendMail(settings, {
        to: recipient.email,
        toName: recipient.name,
        subject: `Voided: “${envelope.title}” is no longer open for signature`,
        html,
        text: `${actorName} voided “${envelope.title}”.${reason ? ` Reason: ${reason}` : ""}`,
      });
      results.push({ email: recipient.email, ...res });
    } catch (err) {
      results.push({ email: recipient.email, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendCcEmails(settings, { envelope, origin, copies }) {
  const results = [];
  const link = `${origin}/envelope/${envelope.id}`;
  for (const recipient of copies || []) {
    const html = wrapHtml({
      intro: "Copied on an envelope",
      title: `You were copied on “${escapeHtml(envelope.title)}”`,
      greeting: `Hello ${escapeHtml(recipient.name || "")},`,
      body: `You were added as a carbon copy on this envelope. You do not need to sign. You will receive the completed PDF when every signer has finished.`,
      details: [
        { label: "Document", value: escapeHtml(envelope.title) },
        { label: "Status", value: "Out for signature" },
      ],
      ctaLabel: "",
      ctaHref: "",
      footer: `Open in DocySign after you create an account with ${escapeHtml(recipient.email)}. ${link}`,
    });
    try {
      const res = await sendMail(settings, {
        to: recipient.email,
        toName: recipient.name,
        subject: `Copied: “${envelope.title}” was sent for signature`,
        html,
        text: `You were copied on “${envelope.title}”.`,
      });
      results.push({ email: recipient.email, ...res });
    } catch (err) {
      results.push({ email: recipient.email, sent: false, error: err.message });
    }
  }
  return results;
}

async function sendTestEmail(settings, to) {
  const html = wrapHtml({
    intro: "Delivery test",
    title: "Your DocySign mail settings are working",
    greeting: "Hello,",
    body: "This is a test message from DocySign. If you received it, your Gmail or Postfix SMTP configuration is ready to send signing requests.",
    details: [{ label: "Status", value: "SMTP connected" }],
    ctaLabel: "",
    ctaHref: "",
    footer: "You can ignore this message. It was sent from Email settings in your DocySign workspace.",
  });
  return sendMail(settings, {
    to,
    subject: "DocySign SMTP test",
    html,
    text: "DocySign SMTP test succeeded.",
  });
}

module.exports = {
  envSettings,
  isConfigured,
  publicSettings,
  sendRequestEmails,
  sendCompletedEmails,
  sendReminderEmails,
  sendDeclinedEmails,
  sendVoidedEmails,
  sendCcEmails,
  sendTestEmail,
};
