"use client";

import { useCallback, useState } from "react";

export default function CopyButton({
  text,
  label = "copy",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  }, [text]);

  return (
    <button className="copy" onClick={onClick} type="button" aria-live="polite">
      {done ? "copied" : label}
    </button>
  );
}
