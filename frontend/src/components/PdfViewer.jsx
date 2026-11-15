import { useEffect, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getToken } from "../api.js";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const DISPLAY_SCALE = 1.35;
const MIN_SIZE = 2; // smallest field size, in percent of the page

/**
 * Renders a PDF with field boxes on top. Field positions and sizes are
 * percentages of the page, so they stay correct at any width.
 *
 * With `interactive`, boxes can be dragged, resized from the corner handle
 * and removed; clicking the page calls `onPlace`.
 */
export default function PdfViewer({
  src,
  fields = [],
  activeId,
  onSelect,
  onMove,
  onResize,
  onPlace,
  onDelete,
  interactive = false,
  placing = false,
  renderValue,
}) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    async function load() {
      setError("");
      setPages([]);
      setLoading(true);
      try {
        const token = getToken();
        const res = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("Could not load PDF");
        const data = await res.arrayBuffer();
        doc = await pdfjs.getDocument({ data }).promise;
        // Render sharper on high-density screens without changing layout size.
        const density = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: DISPLAY_SCALE });
          const hi = page.getViewport({ scale: DISPLAY_SCALE * density });
          const canvas = document.createElement("canvas");
          canvas.width = hi.width;
          canvas.height = hi.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: hi }).promise;
          if (cancelled) return;
          const rendered = {
            page: i,
            url: canvas.toDataURL("image/jpeg", 0.92),
            width: viewport.width,
            height: viewport.height,
          };
          // Show each page as soon as it is ready.
          setPages((prev) => [...prev, rendered]);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not render PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (doc) doc.destroy();
    };
  }, [src]);

  function handleClick(e, page) {
    if (!interactive || !onPlace) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onPlace({ page, x, y });
  }

  // Follows the pointer until it is released, reporting movement as a
  // percentage of the page the field sits on.
  function track(e, onDelta) {
    e.preventDefault();
    e.stopPropagation();
    const pageEl = e.currentTarget.closest(".pdf-page");
    const rect = pageEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    function move(ev) {
      onDelta(((ev.clientX - startX) / rect.width) * 100, ((ev.clientY - startY) / rect.height) * 100);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startDrag(e, field) {
    if (!interactive || !onMove) return;
    if (e.button !== undefined && e.button !== 0) return;
    onSelect && onSelect(field);
    track(e, (dx, dy) => {
      onMove(field.id, {
        x: Math.max(0, Math.min(100 - field.w, field.x + dx)),
        y: Math.max(0, Math.min(100 - field.h, field.y + dy)),
      });
    });
  }

  function startResize(e, field) {
    if (!interactive || !onResize) return;
    track(e, (dx, dy) => {
      onResize(field.id, {
        w: Math.max(MIN_SIZE, Math.min(100 - field.x, field.w + dx)),
        h: Math.max(MIN_SIZE, Math.min(100 - field.y, field.h + dy)),
      });
    });
  }

  if (error) return <div className="error">{error}</div>;
  if (!pages.length) return <div className="hint">Rendering document…</div>;

  return (
    <div className={`pdf-wrap ${placing ? "placing" : ""}`}>
      {pages.map((p) => (
        <div
          key={p.page}
          className="pdf-page"
          style={{ width: p.width, aspectRatio: `${p.width} / ${p.height}` }}
          onClick={(e) => handleClick(e, p.page)}
        >
          <img src={p.url} alt={`Page ${p.page}`} draggable={false} />
          {fields
            .filter((f) => f.page === p.page)
            .map((f) => (
              <div
                key={f.id}
                className={[
                  "field-box",
                  activeId === f.id ? "active" : "",
                  f.value ? "filled" : "",
                  interactive ? "movable" : "",
                  f.required === false ? "optional" : "",
                ].join(" ")}
                style={{
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  width: `${f.w}%`,
                  height: `${f.h}%`,
                }}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onPointerDown={(e) => startDrag(e, f)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect && onSelect(f);
                }}
                onKeyDown={(e) => {
                  if (!onSelect || e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(f);
                  }
                }}
              >
                {onDelete && (
                  <button
                    type="button"
                    className="field-delete"
                    title="Remove field"
                    aria-label="Remove field"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(f.id);
                    }}
                  >
                    ×
                  </button>
                )}
                <span className="field-label">{renderValue ? renderValue(f) : f.type}</span>
                {interactive && onResize && activeId === f.id && (
                  <span
                    className="field-resize"
                    title="Drag to resize"
                    onPointerDown={(e) => startResize(e, f)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </div>
            ))}
        </div>
      ))}
      {loading && <div className="hint">Rendering more pages…</div>}
    </div>
  );
}
