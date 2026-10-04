import type { ReactNode } from 'react';

/*
  Renders the small Markdown subset CHANGELOG.md uses — "### " headings, bullets (optionally
  indented), **bold**, `code` and plain paragraphs — as real React elements. Deliberately no
  Markdown library and no dangerouslySetInnerHTML: release notes also arrive from the network
  (latest.json), and text from the network must never be injected as HTML.
*/

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="rounded bg-surface-3 px-1 py-0.5 text-[11.5px]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function ReleaseNotes({ body }: { body: string }) {
  const blocks: ReactNode[] = [];

  body.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith('## ')) return;

    if (line.startsWith('### ')) {
      blocks.push(
        <h4 key={i} className={`num text-[13px] font-semibold text-ink ${blocks.length > 0 ? 'mt-4' : ''}`}>
          {line.slice(4)}
        </h4>
      );
      return;
    }

    const bullet = /^(\s*)[*-]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push(
        <div key={i} className={`flex gap-2.5 text-[13px] leading-relaxed text-muted ${bullet[1].length >= 2 ? 'ml-5' : ''}`}>
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" />
          <span className="min-w-0">{inline(bullet[2])}</span>
        </div>
      );
      return;
    }

    blocks.push(<p key={i} className="text-[13px] leading-relaxed text-muted">{inline(line.trim())}</p>);
  });

  return <div className="space-y-1.5">{blocks}</div>;
}
