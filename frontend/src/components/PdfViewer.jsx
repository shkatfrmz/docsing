import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getToken } from "../api.js";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfViewer({
  src,
  fields = [],
  activeId,
  onSelect,
  onMove,
  onPlace,
  onDelete,
  interactive = false,
  renderValue,
}) {
  const wrapRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      setPages([]);
      try {
        const token = getToken();
        const res = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("Could not load PDF");
        const data = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data }).promise;
        const next = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          next.push({
            page: i,
            url: canvas.toDataURL("image/png"),
            width: viewport.width,
            height: viewport.height,
          });
        }
        if (!cancelled) setPages(next);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not render PDF");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [src]);

  function handleClick(e, page, width, height) {
    if (!interactive || !onPlace) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / width) * 100;
    const y = ((e.clientY - rect.top) / height) * 100;
    onPlace({ page, x, y });
  }

  function startDrag(e, field, width, height) {
    if (!interactive || !onMove) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = field.x;
    const origY = field.y;
    function move(ev) {
      const dx = ((ev.clientX - startX) / width) * 100;
      const dy = ((ev.clientY - startY) / height) * 100;
      onMove(field.id, {
        x: Math.max(0, Math.min(100 - field.w, origX + dx)),
        y: Math.max(0, Math.min(100 - field.h, origY + dy)),
      });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  if (error) return <div className="error">{error}</div>;
  if (!pages.length) return <div className="hint">Rendering document…</div>;

  return (
    <div className="pdf-wrap" ref={wrapRef}>
      {pages.map((p) => (
        <div
          key={p.page}
          className="pdf-page"
          style={{ width: p.width, height: p.height }}
          onClick={(e) => handleClick(e, p.page, p.width, p.height)}
        >
          <img src={p.url} alt={`Page ${p.page}`} width={p.width} height={p.height} />
          {fields
            .filter((f) => f.page === p.page)
            .map((f) => (
              <div
                key={f.id}
                className={`field-box ${activeId === f.id ? "active" : ""} ${f.value ? "filled" : ""}`}
                style={{
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  width: `${f.w}%`,
                  height: `${f.h}%`,
                }}
                onMouseDown={(e) => startDrag(e, f, p.width, p.height)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect && onSelect(f);
                }}
              >
                {onDelete && (
                  <button
                    type="button"
                    className="field-delete"
                    title="Remove field"
                    aria-label="Remove field"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(f.id);
                    }}
                  >
                    ×
                  </button>
                )}
                {renderValue ? renderValue(f) : f.type}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
