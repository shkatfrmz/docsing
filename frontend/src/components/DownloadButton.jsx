import { useState } from "react";
import { downloadEnvelope } from "../api.js";

/** Downloads an envelope's PDF without putting the session in a link. */
export default function DownloadButton({ id, className = "btn btn-primary", children = "Download PDF" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      await downloadEnvelope(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={run}>
        {busy ? "Downloading…" : children}
      </button>
      {error && <span className="error" role="alert">{error}</span>}
    </>
  );
}
