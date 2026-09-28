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
  const link = `${origin}/preview/${envelope.id}`;
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
    signToken: null,
    link,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

module.exports = { requestEmail, completedEmail };
