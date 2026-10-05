const { randomUUID: uuid } = require("crypto");

function requestEmail({ senderName, senderEmail, signer, envelope, origin }) {
  const link = `${origin}/sign/${signer.token}`;
  return {
    id: uuid(),
    to: signer.email.toLowerCase(),
    toName: signer.name,
    fromName: senderName,
    fromEmail: senderEmail,
    subject: `${senderName} sent you “${envelope.title}” to sign`,
    preview: `${senderName} requested your ${signer.role === "approver" ? "approval" : "signature"} on ${envelope.title}.`,
    body: envelope.message || "Please review and sign this document.",
    type: "request",
    envelopeId: envelope.id,
    envelopeTitle: envelope.title,
    signToken: signer.token,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function completedEmail({ recipient, envelope, origin }) {
  const party = envelope.signers.find((s) => s.email.toLowerCase() === recipient.email.toLowerCase());
  const link = party?.token ? `${origin}/sign/${party.token}` : `${origin}/preview/${envelope.id}`;
  return {
    id: uuid(),
    to: recipient.email.toLowerCase(),
    toName: recipient.name,
    fromName: "DocySign",
    fromEmail: "docs@docysign.app",
    subject: `Completed: “${envelope.title}” is fully signed`,
    preview: `Everyone has signed. The final PDF is in your workspace.`,
    body: `All parties have signed “${envelope.title}”. The completed document is now in your DocySign workspace. You can preview, print, or download it.`,
    type: "completed",
    envelopeId: envelope.id,
    envelopeTitle: envelope.title,
    signToken: party?.token || null,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function reminderEmail({ senderName, senderEmail, signer, envelope, origin }) {
  const link = `${origin}/sign/${signer.token}`;
  return {
    id: uuid(),
    to: signer.email.toLowerCase(),
    toName: signer.name,
    fromName: senderName,
    fromEmail: senderEmail,
    subject: `Reminder: “${envelope.title}” is still waiting on you`,
    preview: `${senderName} asked you again to ${signer.role === "approver" ? "approve" : "sign"} ${envelope.title}.`,
    body: `${senderName} sent a reminder. Please review and ${signer.role === "approver" ? "approve" : "sign"} this document.`,
    type: "reminder",
    envelopeId: envelope.id,
    envelopeTitle: envelope.title,
    signToken: signer.token,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function declinedEmail({ recipient, envelope, signer, reason, origin }) {
  const link = `${origin}/envelope/${envelope.id}`;
  return {
    id: uuid(),
    to: recipient.email.toLowerCase(),
    toName: recipient.name,
    fromName: "DocySign",
    fromEmail: "docs@docysign.app",
    subject: `Declined: “${envelope.title}” was not signed`,
    preview: `${signer.name} declined to sign ${envelope.title}.`,
    body: `${signer.name} (${signer.email}) declined “${envelope.title}”.${reason ? ` Reason: ${reason}` : ""} The envelope is now closed.`,
    type: "declined",
    envelopeId: envelope.id,
    envelopeTitle: envelope.title,
    signToken: null,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function voidedEmail({ recipient, envelope, reason, origin, actorName }) {
  const link = `${origin}/envelope/${envelope.id}`;
  return {
    id: uuid(),
    to: recipient.email.toLowerCase(),
    toName: recipient.name,
    fromName: "DocySign",
    fromEmail: "docs@docysign.app",
    subject: `Voided: “${envelope.title}” is no longer open for signature`,
    preview: `${actorName} voided ${envelope.title}.`,
    body: `${actorName} voided “${envelope.title}”.${reason ? ` Reason: ${reason}` : ""} The envelope is closed and no further signatures will be collected.`,
    type: "voided",
    envelopeId: envelope.id,
    envelopeTitle: envelope.title,
    signToken: null,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function ccEmail({ recipient, envelope, origin }) {
  const link = `${origin}/envelope/${envelope.id}`;
  return {
    id: uuid(),
    to: recipient.email.toLowerCase(),
    toName: recipient.name,
    fromName: "DocySign",
    fromEmail: "docs@docysign.app",
    subject: `Copied: “${envelope.title}” was sent for signature`,
    preview: `You were copied on ${envelope.title}.`,
    body: `You were copied on “${envelope.title}”. You do not need to sign. You will also receive the completed PDF when everyone has signed.`,
    type: "cc",
    envelopeId: envelope.id,
    envelopeTitle: envelope.title,
    signToken: null,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

module.exports = { requestEmail, completedEmail, reminderEmail, declinedEmail, voidedEmail, ccEmail };
