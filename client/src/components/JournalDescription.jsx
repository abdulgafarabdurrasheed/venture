import { useEffect, useState } from "react";
import {
  isVideoUrl,
  journalDisplaySrc,
  parseJournalDescription,
} from "../utils/mediaUrls.js";

function JournalMedia({ url, rawUrl, alt, className, staffReview }) {
  const displaySrc = journalDisplaySrc({ resolved: url, rawUrl, alt, staffReview });
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const usesStaffProxy = staffReview && Boolean(displaySrc?.includes("/api/admin/review/media"));

  useEffect(() => {
    if (!usesStaffProxy || !displaySrc) {
      setObjectUrl(null);
      setFailed(false);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let blobUrl = null;
    setLoading(true);
    setFailed(false);
    setObjectUrl(null);

    fetch(displaySrc, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Media request failed (${response.status})`);
        }
        const blob = await response.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setObjectUrl(blobUrl);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [displaySrc, usesStaffProxy]);

  if (!displaySrc) {
    return (
      <span className="journal-media-fallback">
        {alt || "Attachment unavailable"}
      </span>
    );
  }

  if (usesStaffProxy) {
    if (loading) {
      return <span className="journal-media-loading">Loading attachment…</span>;
    }

    if (failed || !objectUrl) {
      return (
        <span className="journal-media-fallback">
          {alt ? `${alt} — ` : ""}
          Could not load attachment.
        </span>
      );
    }

    if (isVideoUrl(rawUrl || url || alt)) {
      return <video className={className} src={objectUrl} controls preload="metadata" />;
    }

    return (
      <img
        className={className}
        src={objectUrl}
        alt={alt || "Journal attachment"}
      />
    );
  }

  if (failed) {
    return (
      <span className="journal-media-fallback">
        {alt ? `${alt} — ` : ""}
        Could not load attachment.
      </span>
    );
  }

  if (isVideoUrl(rawUrl || url || alt)) {
    return <video className={className} src={displaySrc} controls preload="metadata" />;
  }

  return (
    <img
      className={className}
      src={displaySrc}
      alt={alt || "Journal attachment"}
      onError={() => setFailed(true)}
    />
  );
}

export function JournalDescription({
  text,
  className = "journal-description",
  mediaClassName = "journal-media-item",
  staffReview = false,
}) {
  const parts = parseJournalDescription(text);
  if (parts.length === 0) return null;

  return (
    <div className={className}>
      {parts.map((part, i) =>
        part.type === "text" ? (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {part.value}
          </span>
        ) : (
          <JournalMedia
            key={`${i}-${part.rawUrl || part.url || part.alt}`}
            url={part.url}
            rawUrl={part.rawUrl}
            alt={part.alt}
            className={mediaClassName}
            staffReview={staffReview}
          />
        )
      )}
    </div>
  );
}
