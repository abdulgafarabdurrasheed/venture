import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";
import "./ExplorePage.css";

function canStaffReview(role) {
  return role === "reviewer" || role === "admin" || role === "superadmin";
}

function seenStorageKey(user) {
  return `offtrack-explore-seen:${user?.id || "visitor"}`;
}

function readSeen(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]").map(String));
  } catch {
    return new Set();
  }
}

export function ExplorePage() {
  const { user, reload } = useAuth();
  const scrollRef = useRef(null);
  const sentSeen = useRef(new Set());
  const storageKey = useMemo(() => seenStorageKey(user), [user?.id]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [commentsProject, setCommentsProject] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const staff = canStaffReview(user?.role);

  const loadProjects = useCallback(async (query = activeSearch) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      const response = await fetch(`/api/explore/projects${params.size ? `?${params}` : ""}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Explore projects.");
      const seen = query.trim() ? new Set() : readSeen(storageKey);
      setProjects((data.projects || []).filter((project) => !seen.has(String(project.id))));
      sentSeen.current.clear();
    } catch (loadError) {
      setError(loadError.message || "Could not load Explore projects.");
    } finally {
      setLoading(false);
    }
  }, [activeSearch, storageKey]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!scrollRef.current || !projects.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
        const id = entry.target.dataset.projectId;
        if (!id || sentSeen.current.has(id)) continue;
        sentSeen.current.add(id);
        const seen = readSeen(storageKey);
        seen.add(String(id));
        localStorage.setItem(storageKey, JSON.stringify([...seen]));
        if (user?.id) {
          apiFetch(`/api/explore/projects/${id}/view`, { method: "POST" }).catch(() => {});
        }
      }
    }, { root: scrollRef.current, threshold: [0.6] });
    scrollRef.current.querySelectorAll("[data-project-id]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [projects, storageKey, user?.id, activeSearch]);

  function submitSearch(event) {
    event.preventDefault();
    const query = searchDraft.trim();
    setActiveSearch(query);
    if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToNext(direction = 1) {
    const root = scrollRef.current;
    if (!root) return;
    const slides = [...root.querySelectorAll("[data-project-id]")];
    if (!slides.length) return;
    const rootCenter = root.getBoundingClientRect().top + root.clientHeight / 2;
    const current = slides.reduce((bestIndex, slide, index) => {
      const rect = slide.getBoundingClientRect();
      const bestRect = slides[bestIndex].getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - rootCenter) < Math.abs(bestRect.top + bestRect.height / 2 - rootCenter)
        ? index
        : bestIndex;
    }, 0);
    const target = slides[Math.min(slides.length - 1, Math.max(0, current + direction))];
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (commentsProject) return;
      event.preventDefault();
      goToNext(event.key === "ArrowDown" ? 1 : -1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commentsProject, projects]);

  async function toggleLike(project) {
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusyAction(`like:${project.id}`);
    setError("");
    try {
      const response = await apiFetch(`/api/projects/${project.id}/like`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update like.");
      setProjects((current) => current.map((item) => item.id === project.id
        ? { ...item, likedByViewer: data.liked, likeCount: data.likeCount }
        : item));
    } catch (actionError) {
      setError(actionError.message || "Could not update like.");
    } finally {
      setBusyAction("");
    }
  }

  async function toggleFollow(project) {
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusyAction(`follow:${project.id}`);
    setError("");
    try {
      const response = await apiFetch(`/api/participants/${project.owner.id}/follow`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update follow.");
      setProjects((current) => current.map((item) => item.owner.id === project.owner.id
        ? { ...item, owner: { ...item.owner, followedByViewer: data.following, followerCount: data.followerCount } }
        : item));
    } catch (actionError) {
      setError(actionError.message || "Could not update follow.");
    } finally {
      setBusyAction("");
    }
  }

  async function openComments(project) {
    setCommentsProject(project);
    setComments([]);
    setCommentError("");
    setCommentsLoading(true);
    try {
      const response = await fetch(`/api/projects/${project.id}/comments`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load comments.");
      setComments(data.comments || []);
    } catch (loadError) {
      setCommentError(loadError.message || "Could not load comments.");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function postComment(event) {
    event.preventDefault();
    if (!commentsProject || !commentDraft.trim()) return;
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusyAction("comment");
    setCommentError("");
    try {
      const response = await apiFetch(`/api/projects/${commentsProject.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not post comment.");
      setCommentDraft("");
      const refreshed = await fetch(`/api/projects/${commentsProject.id}/comments`, { credentials: "include" });
      const refreshedData = await refreshed.json();
      setComments(refreshedData.comments || []);
      setProjects((current) => current.map((item) => item.id === commentsProject.id
        ? { ...item, commentCount: Number(item.commentCount || 0) + 1 }
        : item));
    } catch (postError) {
      setCommentError(postError.message || "Could not post comment.");
    } finally {
      setBusyAction("");
    }
  }

  async function awardStar(project) {
    if (!project?.canAwardStar || busyAction) return;
    setBusyAction(`star:${project.id}`);
    setError("");
    try {
      const response = await apiFetch(`/api/explore/projects/${project.id}/star`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not award a star.");
      setProjects((current) => current.map((item) => item.id === project.id
        ? { ...item, stars: Number(data.project?.stars ?? item.stars + 1), canAwardStar: false, alreadyAwardedByStaff: true, owner: { ...item.owner, totalStars: data.participantTotalStars } }
        : item.owner.id === project.owner.id
          ? { ...item, canAwardStar: Number(data.participantTotalStars) < 5, owner: { ...item.owner, totalStars: data.participantTotalStars } }
        : item));
      await reload?.();
    } catch (actionError) {
      setError(actionError.message || "Could not award a star.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <main className="explore-shorts" ref={scrollRef} aria-label="Explore projects">
      <header className="explore-shorts__topbar">
        <a className="explore-shorts__brand" href="/explore">OFF-TRACK <span>Explore</span></a>
        <form className="explore-shorts__search" onSubmit={submitSearch}>
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search projects or makers" aria-label="Search projects or makers" />
          <button type="submit" aria-label="Search">⌕</button>
          {activeSearch ? <button type="button" aria-label="Clear search" onClick={() => { setSearchDraft(""); setActiveSearch(""); }}>×</button> : null}
        </form>
        <nav className="explore-shorts__nav" aria-label="Explore navigation">
          <a href="/projects">My projects</a>
          {user ? <a href={`/participants/${encodeURIComponent(user.slug || user.id)}`}>My page</a> : <a href={`/login?returnTo=${encodeURIComponent("/explore")}`}>Sign in</a>}
        </nav>
      </header>

      {error ? <p className="explore-shorts__error" role="alert">{error}</p> : null}
      {loading && projects.length === 0 ? <p className="explore-shorts__state">Loading projects…</p> : null}
      {!loading && projects.length === 0 ? (
        <section className="explore-shorts__empty">
          <h1>{activeSearch ? "No matching projects" : "You’re all caught up"}</h1>
          <p>{activeSearch ? "Try another title or maker name." : "Search to revisit projects you have already seen."}</p>
        </section>
      ) : null}

      <section className="explore-shorts__feed" aria-label="Projects, oldest first">
        {projects.map((project) => {
          const href = `/participants/${encodeURIComponent(project.owner.slug || project.owner.id)}`;
          return (
            <article className="explore-short" key={project.id} data-project-id={project.id}>
              {project.imageUrl ? <img className="explore-short__image" src={resolveStackAssetUrl(project.imageUrl)} alt={`${project.name} preview`} /> : <div className="explore-short__image explore-short__image--empty">No project image</div>}
              <div className="explore-short__shade" />
              <aside className="explore-short__actions" aria-label={`${project.name} actions`}>
                <a className="explore-short__avatar" href={href} aria-label={`Open ${project.owner.name}'s page`}>
                  {project.owner.profileImageUrl ? <img src={resolveStackAssetUrl(project.owner.profileImageUrl)} alt="" /> : <span>{project.owner.name.slice(0, 1).toUpperCase()}</span>}
                </a>
                {!project.isOwnProject ? <button className="explore-short__follow" disabled={busyAction === `follow:${project.id}`} onClick={() => toggleFollow(project)} aria-label={project.owner.followedByViewer ? `Unfollow ${project.owner.name}` : `Follow ${project.owner.name}`}>{project.owner.followedByViewer ? "✓" : "+"}</button> : null}
                <button className={`explore-short__action${project.likedByViewer ? " is-active" : ""}`} onClick={() => toggleLike(project)} disabled={busyAction === `like:${project.id}`} aria-label={project.likedByViewer ? "Unlike project" : "Like project"}>
                  <span>♥</span><small>{project.likeCount}</small>
                </button>
                <button className="explore-short__action" onClick={() => openComments(project)} aria-label="Open comments">
                  <span>▤</span><small>{project.commentCount}</small>
                </button>
                {staff && project.canAwardStar ? <button className="explore-short__action explore-short__star" onClick={() => awardStar(project)} disabled={busyAction === `star:${project.id}`} aria-label="Give one star"><span>☆</span><small>Star</small></button> : null}
                <button className="explore-short__action" onClick={() => goToNext(1)} aria-label="Next project"><span>↓</span><small>Next</small></button>
              </aside>
              <div className="explore-short__caption">
                <a className="explore-short__maker" href={href}>{project.owner.name}</a>
                <h1>{project.name || "Untitled project"}</h1>
                <p className="explore-short__description">{project.description || "No description yet."}</p>
                <div className="explore-short__meta">
                  {project.projectType ? <span>{project.projectType}</span> : null}
                  <span>{project.shipped ? "Shipped" : "In progress"}</span>
                  {Number(project.stars) > 0 ? <span>★ {project.stars}</span> : null}
                </div>
                <div className="explore-short__links">
                  <a href={`/project/${project.id}`}>Project details</a>
                  {project.playableUrl ? <a href={project.playableUrl} target="_blank" rel="noreferrer">Open project ↗</a> : null}
                  {project.codeUrl ? <a href={project.codeUrl} target="_blank" rel="noreferrer">View code ↗</a> : null}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {commentsProject ? (
        <div className="explore-comments__scrim" role="presentation" onClick={() => setCommentsProject(null)}>
          <section className="explore-comments" role="dialog" aria-modal="true" aria-label={`Comments for ${commentsProject.name}`} onClick={(event) => event.stopPropagation()}>
            <header><div><h2>Comments</h2><p>{commentsProject.name}</p></div><button type="button" onClick={() => setCommentsProject(null)} aria-label="Close comments">×</button></header>
            <div className="explore-comments__list">
              {commentsLoading ? <p>Loading comments…</p> : null}
              {!commentsLoading && comments.length === 0 ? <p>Start the conversation.</p> : null}
              {comments.map((comment) => <article key={comment.id}>
                <a href={`/participants/${encodeURIComponent(comment.author.slug || comment.author.id)}`}>{comment.author.name}</a>
                <p>{comment.body}</p>
                <time>{new Date(comment.createdAt).toLocaleString()}</time>
              </article>)}
            </div>
            <form onSubmit={postComment}>
              <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={2000} placeholder={user ? "Add a comment…" : "Sign in to comment"} aria-label="Comment" />
              <button type="submit" disabled={!commentDraft.trim() || busyAction === "comment"}>{busyAction === "comment" ? "Posting…" : "Post"}</button>
            </form>
            {commentError ? <p className="explore-comments__error" role="alert">{commentError}</p> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
