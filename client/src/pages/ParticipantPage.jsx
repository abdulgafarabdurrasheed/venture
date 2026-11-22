import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";
import "./PublicPages.css";

export function ParticipantPage({ identifier }) {
  const { user } = useAuth();
  const [participant, setParticipant] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/participants/${encodeURIComponent(identifier)}`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load participant page.");
        if (active) {
          setParticipant(data.participant);
          setProjects(data.projects || []);
          setError("");
        }
      })
      .catch((loadError) => { if (active) setError(loadError.message || "Could not load participant page."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identifier]);

  async function toggleFollow() {
    if (!participant) return;
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    if (!user) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`/api/participants/${participant.id}/follow`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update follow.");
      setParticipant((current) => ({ ...current, followedByViewer: data.following, followerCount: data.followerCount }));
    } catch (actionError) {
      setError(actionError.message || "Could not update follow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlatformLayout activeTab="projects" contentClassName="platform-frame__content--public-page">
      <main className="public-page participant-page">
        {loading ? <p className="public-page__state">Loading participant…</p> : null}
        {error ? <p className="public-page__error" role="alert">{error}</p> : null}
        {!loading && participant ? <>
          <a className="public-page__back" href="/explore">← Explore</a>
          <header className="participant-page__profile">
            <div className="participant-page__avatar">
              {participant.profileImageUrl ? <img src={resolveStackAssetUrl(participant.profileImageUrl)} alt="" /> : <span>{participant.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="participant-page__identity">
              <p>VENTURE MAKER</p>
              <h1>{participant.name}</h1>
              {participant.slug ? <p className="participant-page__handle">@{participant.slug}</p> : null}
              <div className="participant-page__stats">
                <span><strong>{participant.projectCount}</strong> projects</span>
                <span><strong>{participant.shippedCount}</strong> shipped</span>
                <span><strong>{participant.followerCount}</strong> followers</span>
                <span><strong>{participant.totalStars}</strong> stars</span>
                <span><strong>{Number(participant.approvedHours).toFixed(1)}</strong> approved hours</span>
              </div>
            </div>
            {!participant.isOwnProfile ? <button className="public-page__button" type="button" disabled={busy} onClick={toggleFollow}>{participant.followedByViewer ? "Following" : "Follow"}</button> : null}
          </header>
          <section className="public-project-grid" aria-label={`${participant.name}'s projects`}>
            <h2>Projects <span>{participant.projectCount}</span></h2>
            {projects.length === 0 ? <p>This maker hasn’t added any visible projects yet.</p> : null}
            <div className="public-project-grid__items">
              {projects.map((project) => <a className="public-project-card" href={`/project/${project.id}`} key={project.id}>
                {project.imageUrl ? <img src={resolveStackAssetUrl(project.imageUrl)} alt="" loading="lazy" /> : <div className="public-project-card__placeholder">Off-Track</div>}
                <div><span>{project.projectType || "Project"} · {project.shipped ? "Shipped" : "In progress"}</span><h3>{project.name}</h3><p>{project.description || "No description yet."}</p><small>♥ {project.likeCount} · {project.commentCount} comments</small></div>
              </a>)}
            </div>
          </section>
        </> : null}
      </main>
    </PlatformLayout>
  );
}
