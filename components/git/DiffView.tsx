export default function DiffView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  const capped = lines.slice(0, 500);

  return (
    <pre className="diff">
      {capped.map((line, i) => {
        const cls = line.startsWith("@@")
          ? "diff-hunk"
          : line.startsWith("+")
            ? "diff-add"
            : line.startsWith("-")
              ? "diff-del"
              : "diff-ctx";
        return (
          <span className={`diff-line ${cls}`} key={i}>
            {line || " "}
          </span>
        );
      })}
      {lines.length > capped.length ? (
        <span className="diff-line diff-more">
          … {lines.length - capped.length} more lines
        </span>
      ) : null}
    </pre>
  );
}
