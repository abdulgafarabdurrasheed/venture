import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import { resolveStackAssetUrl } from "../utils/mediaUrls.js";
import "./ExplorePage.css";

function canStaffReview(role) {
  return role === "reviewer" || role === "admin" || role === "superadmin";
}

export function ExplorePage() {
  const { user, reload } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [awardingProjectId, setAwardingProjectId] = useState(null);

  const loadProjects = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/explore/projects", { credentials: "include", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Explore projects.");
      setProjects(data.projects || []);
    } catch (loadError) {
      setError(loadError.message || "Could not load Explore projects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function awardStar(project) {
    if (!project?.id || !project.canAwardStar || awardingProjectId) return;
    setAwardingProjectId(project.id);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/api/explore/projects/${project.id}/star`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not award a star.");
      setProjects((current) => current.map((item) => item.id === project.id
        ? { ...item, stars: Number(data.project?.stars ?? item.stars + 1), canAwardStar: false, alreadyAwardedByStaff: true }
        : item));
      setMessage(`You awarded ${project.name || "this project"} a star.`);
      await reload?.();
    } catch (awardError) {
      setError(awardError.message || "Could not award a star.");
      await loadProjects();
    } finally {
      setAwardingProjectId(null);
    }
  }

  const staff = canStaffReview(user?.role);

  return (
    <PlatformLayout activeTab="projects" contentClassName="platform-frame__content--explore">
      <main className="explore-page">
        <header className="explore-page__header">
          <div>
            <h1>Explore projects</h1>
            <p>See what Venture makers have shipped.</p>
          </div>
          <a href="/projects">My projects</a>
        </header>

        {message ? <p className="explore-page__notice" role="status">{message}</p> : null}
        {error ? <p className="explore-page__error" role="alert">{error}</p> : null}
        {loading ? <p className="explore-page__empty">Loading projects…</p> : null}
        {!loading && !error && projects.length === 0 ? (
          <p className="explore-page__empty">No shipped projects to explore yet.</p>
        ) : null}

        <section className="explore-page__grid" aria-label="Shipped projects">
          {projects.map((project) => (
            <article className="explore-card" key={project.id}>
              {project.imageUrl ? (
                <img className="explore-card__image" src={resolveStackAssetUrl(project.imageUrl)} alt="" loading="lazy" />
              ) : <div className="explore-card__image explore-card__image--empty" aria-hidden="true">Venture</div>}
              <div className="explore-card__body">
                <p className="explore-card__maker">{project.owner?.name || "Venture maker"}</p>
                <h2>{project.name || "Untitled project"}</h2>
                {project.projectType ? <span className="explore-card__type">{project.projectType}</span> : null}
                {project.description ? <p className="explore-card__description">{project.description}</p> : null}
                <p className="explore-card__stars" aria-label={`${Number(project.stars || 0)} stars`}>
                  {"★".repeat(Math.min(Number(project.stars || 0), 5))}{"☆".repeat(Math.max(0, 5 - Number(project.stars || 0)))}
                  <span>{Number(project.stars || 0)} project stars</span>
                </p>
                <div className="explore-card__links">
                  {project.playableUrl ? <a href={project.playableUrl} target="_blank" rel="noreferrer">Open project</a> : null}
                  {project.codeUrl ? <a href={project.codeUrl} target="_blank" rel="noreferrer">View code</a> : null}
                </div>
                {staff && project.canAwardStar ? (
                  <button
                    type="button"
                    className="explore-card__star-button"
                    disabled={awardingProjectId === project.id}
                    onClick={() => awardStar(project)}
                  >
                    {awardingProjectId === project.id ? "Giving star…" : "Give 1 star"}
                  </button>
                ) : staff && project.alreadyAwardedByStaff ? (
                  <p className="explore-card__staff-note">You&apos;ve already starred this project.</p>
                ) : staff && project.isOwnProject ? (
                  <p className="explore-card__staff-note">You can&apos;t star your own project.</p>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </main>
    </PlatformLayout>
  );
}
