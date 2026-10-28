import Link from "next/link";
import { relativeTime, type CommitItem } from "@/lib/git";

export default function CommitStrip({ commit }: { commit: CommitItem | null }) {
  if (!commit) {
    return (
      <div className="commit-strip commit-strip-empty">
        <span className="mono">commit data unavailable</span>
      </div>
    );
  }

  return (
    <Link className="commit-strip" href={`/git/commit/${commit.sha}`}>
      <span className="commit-sha">{commit.sha.slice(0, 7)}</span>
      <span className="commit-msg">{commit.message.split("\n")[0]}</span>
      <span className="commit-by">
        <span className="commit-author">{commit.authorName}</span>
        <span className="commit-when">{relativeTime(commit.date)}</span>
      </span>
    </Link>
  );
}
