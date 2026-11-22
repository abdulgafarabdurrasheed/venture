import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { CommunityImage } from "../components/CommunityImage.jsx";
import { JournalDescription } from "../components/JournalDescription.jsx";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import "./PublicPages.css";

function displayDate(value) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : date.toLocaleString();
}

export function PublicProjectPage({ projectId }) {
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [pageData, setPageData] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentError, setCommentError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadComments() {
    const response = await fetch(`/api/projects/${projectId}/comments`, { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load comments.");
    setComments(data.comments || []);
    setCommentError("");
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setCommentError("");
    Promise.all([
      fetch(`/api/public/projects/${projectId}`, { credentials: "include" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load project.");
        return data;
      }),
      fetch(`/api/projects/${projectId}/comments`, { credentials: "include" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load comments.");
        return data.comments || [];
      }).catch((commentsLoadError) => {
        if (active) setCommentError(commentsLoadError.message || "Could not load comments.");
        return [];
      }),
    ]).then(([data, commentList]) => {
      if (!active) return;
      setProject(data.project);
      setPageData(data.data);
      setComments(commentList);
      setError("");
    }).catch((loadError) => { if (active) setError(loadError.message || "Could not load project."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function toggleLike() {
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/like`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update like.");
      setProject((current) => ({ ...current, likedByViewer: data.liked, likeCount: data.likeCount }));
    } catch (actionError) { setError(actionError.message || "Could not update like."); }
    finally { setBusy(false); }
  }

  async function toggleFollow() {
    if (!project) return;
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(`/api/participants/${project.owner.id}/follow`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update follow.");
      setProject((current) => ({ ...current, owner: { ...current.owner, followedByViewer: data.following, followerCount: data.followerCount } }));
    } catch (actionError) { setError(actionError.message || "Could not update follow."); }
    finally { setBusy(false); }
  }

  async function postComment(event) {
    event.preventDefault();
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    if (!commentDraft.trim()) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/comments`, { method: "POST", body: JSON.stringify({ body: commentDraft }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not post comment.");
      setCommentDraft("");
      setProject((current) => ({ ...current, commentCount: Number(current.commentCount || 0) + 1 }));
      try {
        await loadComments();
      } catch {
        setCommentError("Comment posted, but the list could not be refreshed.");
      }
    } catch (actionError) { setError(actionError.message || "Could not post comment."); }
    finally { setBusy(false); }
  }

  return (
    <PlatformLayout activeTab="projects" contentClassName="platform-frame__content--public-page">
      <main className="public-page public-project-page">
        {loading ? <p className="public-page__state">Loading project…</p> : null}
        {error ? <p className="public-page__error" role="alert">{error}</p> : null}
        {!loading && project ? <>
          <a className="public-page__back" href="/explore">← Explore</a>
          <header className="public-project-page__hero">
            <CommunityImage
              className="public-project-page__image"
              placeholderClassName="public-project-page__image--empty"
              src={project.imageUrl}
              alt={`${project.name || "Project"} preview`}
              placeholderText="Preview unavailable"
            />
            <div className="public-project-page__intro">
              <span className="public-page__eyebrow">{project.projectType || "Project"} · {project.shipped ? "Shipped" : "In progress"}</span>
              <h1>{project.name}</h1>
              <p>{project.description || "No description yet."}</p>
              <a className="public-project-page__maker" href={`/participants/${encodeURIComponent(project.owner.slug || project.owner.id)}`}>
                <CommunityImage
                  className="public-project-page__maker-avatar"
                  src={project.owner.profileImageUrl}
                  alt={`${project.owner.name} avatar`}
                  placeholderText={project.owner.name.slice(0, 1).toUpperCase()}
                />
                {project.owner.name}
              </a>
              <div className="public-project-page__actions">
                <button className="public-page__button" type="button" onClick={toggleLike} disabled={busy}>{project.likedByViewer ? "♥ Liked" : "♡ Like"} · {project.likeCount}</button>
                {!project.isOwnProject ? <button className="public-page__button public-page__button--light" type="button" onClick={toggleFollow} disabled={busy}>{project.owner.followedByViewer ? "Following" : "Follow maker"}</button> : null}
                {project.playableUrl ? <a className="public-page__button public-page__button--light" href={project.playableUrl} target="_blank" rel="noreferrer">Open project ↗</a> : null}
                {project.codeUrl ? <a className="public-page__button public-page__button--light" href={project.codeUrl} target="_blank" rel="noreferrer">View code ↗</a> : null}
              </div>
            </div>
          </header>
          <section className="public-project-page__details">
            <div className="public-project-page__facts">
              <article><span>Created</span><strong>{displayDate(pageData?.createdAt)}</strong></article>
              <article><span>Last updated</span><strong>{displayDate(pageData?.updatedAt)}</strong></article>
              <article><span>Shipped</span><strong>{project.shippedAt ? displayDate(project.shippedAt) : "Not shipped yet"}</strong></article>
              <article><span>Approved hours</span><strong>{Number(pageData?.approvedHours || 0).toFixed(2)}</strong></article>
              <article><span>Project stars</span><strong>★ {project.stars}</strong></article>
            </div>
            {project.playableUrl || project.codeUrl ? <div className="public-project-page__links">{project.playableUrl ? <a href={project.playableUrl} target="_blank" rel="noreferrer">Playable project</a> : null}{project.codeUrl ? <a href={project.codeUrl} target="_blank" rel="noreferrer">Source code</a> : null}</div> : null}
          </section>
          <section className="public-journals">
            <h2>Build journal <span>{pageData?.journals?.length || 0} entries</span></h2>
            {!pageData?.journals?.length ? <p>No journal entries have been shared for this project.</p> : null}
            <div className="public-journals__list">
              {(pageData?.journals || []).map((entry) => <article key={entry.id}>
                <header><time>{displayDate(entry.timeDone || entry.createdAt)}</time><strong>{Number(entry.hoursWorked).toFixed(2)} hours</strong></header>
                {entry.toolsUsed?.length ? <p className="public-journals__tools">Tools: {Array.isArray(entry.toolsUsed) ? entry.toolsUsed.join(", ") : entry.toolsUsed}</p> : null}
                <JournalDescription text={entry.description} className="public-journals__description" mediaClassName="public-journals__media" />
                {entry.updatedAt && new Date(entry.updatedAt).getTime() !== new Date(entry.createdAt).getTime() ? <small>Edited {displayDate(entry.updatedAt)}</small> : null}
              </article>)}
            </div>
          </section>
          <section className="public-project-comments">
            <h2>Comments <span>{project.commentCount}</span></h2>
            <form onSubmit={postComment}>
              <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} maxLength={2000} placeholder={user ? "Add a comment…" : "Sign in to comment"} aria-label="Add a comment" />
              <button className="public-page__button" type="submit" disabled={!commentDraft.trim() || busy}>Post comment</button>
            </form>
            <div className="public-project-comments__list">
              {comments.map((comment) => <article key={comment.id}><a href={`/participants/${encodeURIComponent(comment.author.slug || comment.author.id)}`}>{comment.author.name}</a><p>{comment.body}</p><time>{displayDate(comment.createdAt)}</time></article>)}
              {!comments.length ? <p>No comments yet.</p> : null}
            </div>
            {commentError ? <p className="public-page__error" role="alert">{commentError}</p> : null}
          </section>
        </> : null}
      </main>
    </PlatformLayout>
  );
}
