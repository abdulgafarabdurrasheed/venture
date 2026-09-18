import prjBox from "@assets/common_to_pages/prj_box.png";
import "./ProjectAddCard.css";

export function ProjectAddCard({ onClick }) {
  return (
    <button type="button" className="project-add-card" onClick={onClick} aria-label="Create new project">
      <img className="project-add-card__frame" src={prjBox} alt="" aria-hidden="true" />
      <span className="project-add-card__plus" aria-hidden="true">
        +
      </span>
    </button>
  );
}
