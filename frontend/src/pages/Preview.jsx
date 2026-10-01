import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, downloadUrl, fileUrl } from "../api.js";
import PdfViewer from "../components/PdfViewer.jsx";

export default function Preview() {
  const { id } = useParams();
  const [env, setEnv] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get(id).then(setEnv).catch((e) => setError(e.message));
  }, [id]);

  function printDoc() {
    const url = fileUrl(id);
    const w = window.open(url, "_blank", "noopener");
    if (w) {
      w.addEventListener("load", () => w.print());
    }
  }

  if (!env) {
    return (
      <div className="page">
        <h1 className="serif">Unable to open document</h1>
        <p className="error">{error || "Loading…"}</p>
        <p className="meta">
          Preview needs you to be signed in as a party on this envelope.
          If you were invited by email, open the Review and sign link instead — that works without an account.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" to="/app">Workspace</Link>
          <Link className="btn btn-ghost" to="/signup">Create account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">{env.status === "completed" ? "Final document" : "Document preview"}</div>
          <h1 className="serif">{env.title}</h1>
          <p>
            {env.status === "completed" && env.completedAt
              ? `Completed ${new Date(env.completedAt).toLocaleString()}`
              : env.fileName}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={printDoc}>Print</button>
          <a className="btn btn-primary" href={downloadUrl(id)}>Download PDF</a>
          <Link className="btn btn-ghost" to={`/envelope/${id}`}>Envelope</Link>
        </div>
      </div>
      <PdfViewer src={`/api/envelopes/${id}/file`} fields={env.status === "completed" ? [] : env.fields} />
    </div>
  );
}
