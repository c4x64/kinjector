"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";

type File = {
  name: string;
  desc: string;
  code: string;
  html: string;
  lines: number;
  bytes: number;
};

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CodeViewer({ files }: { files: File[] }) {
  const [active, setActive] = useState(0);
  const file = files[active];

  function download() {
    const blob = new Blob([file.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="browser">
      <div className="files" role="tablist" aria-label="Source files">
        <div className="files-label">fixed/</div>
        {files.map((f, i) => (
          <button
            key={f.name}
            className="file"
            role="tab"
            aria-selected={i === active}
            aria-controls="source-panel"
            onClick={() => setActive(i)}
            type="button"
          >
            <span className="file-dot" />
            {f.name}
            <span className="file-meta">{f.lines}</span>
          </button>
        ))}
      </div>

      <div className="code-pane" id="source-panel" role="tabpanel">
        <div className="code-head">
          <span className="code-name">{file.name}</span>
          <span className="code-desc">{file.desc}</span>
          <div className="code-actions">
            <span className="code-desc">{size(file.bytes)}</span>
            <CopyButton key={file.name} text={file.code} />
            <button className="copy" onClick={download} type="button">
              download
            </button>
          </div>
        </div>

        <div
          className="code"
          // Shiki output is generated at build time from the files in source/.
          dangerouslySetInnerHTML={{ __html: file.html }}
        />
      </div>
    </div>
  );
}
