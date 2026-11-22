import { useState } from "react";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";

export function CommunityImage({
  src,
  alt = "",
  className,
  placeholderClassName = "",
  placeholderText = "Image unavailable",
  loading = "lazy",
}) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveStackAssetUrl(src);

  if (!resolved || failed) {
    return (
      <div
        className={[className, placeholderClassName].filter(Boolean).join(" ")}
        role="img"
        aria-label={alt || placeholderText}
      >
        {placeholderText}
      </div>
    );
  }

  return <img className={className} src={resolved} alt={alt} loading={loading} onError={() => setFailed(true)} />;
}
