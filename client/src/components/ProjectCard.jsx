import "./ProjectCard.css";

function formatProjectType(value) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatHackatimeNames(names) {
  if (!Array.isArray(names) || names.length === 0) return "—";
  return names.join(", ");
}

function formatHours(project) {
  const hours = project.combinedHours ?? project.totalHours ?? 0;
  const rounded = Math.round(Number(hours));
  return `${rounded} HOUR${rounded === 1 ? "" : "S"}`;
}

export function ProjectCard({ project, onClick }) {
  const status = (project.status || "draft").toUpperCase();

  return (
    <button type="button" className="project-card" onClick={onClick} aria-label={`Open ${project.name || "project"}`}>
      <header className="project-card__row project-card__row--stripe">
        <div className="project-card__main">
          <span className="project-card__name">{project.name || "Untitled project"}</span>
        </div>
        <div className="project-card__stub" aria-hidden="true" />
        <div className="project-card__side" aria-hidden="true" />
      </header>

      <div className="project-card__row project-card__row--body">
        <div className="project-card__main">
          <p>
            <span className="project-card__label">Type:</span> {formatProjectType(project.projectType)}
          </p>
          <p>
            <span className="project-card__label">Hackatime:</span> {formatHackatimeNames(project.hackatimeNames)}
          </p>
        </div>

        <div className="project-card__stub" aria-hidden="true" />

        <div className="project-card__side">
          <p className="project-card__status">{status}</p>
          <p className="project-card__hours">{formatHours(project)}</p>
        </div>
      </div>

      <footer className="project-card__row project-card__row--stripe" aria-hidden="true">
        <div className="project-card__main" />
        <div className="project-card__stub" />
        <div className="project-card__side" />
      </footer>
    </button>
  );
}
