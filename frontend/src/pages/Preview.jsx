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

  if (!env) return <div className="page">{error || "Loading…"}</div>;

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
