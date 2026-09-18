import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { JournalModal } from "../components/JournalModal.jsx";
import { ProjectAddCard } from "../components/ProjectAddCard.jsx";
import { ProjectCard } from "../components/ProjectCard.jsx";
import {
  ProjectDetailModal,
  ProjectFormModal,
  validateProjectForm,
} from "../components/ProjectModals.jsx";
import { PlatformLayout } from "../platform/PlatformLayout.jsx";
import { HoursReductionWarning } from "../components/HoursReductionWarning.jsx";
import { journalDescriptionMediaIsCdnOnly } from "../utils/cdnLinks.js";
import {
  EMPTY_JOURNAL_ENTRY,
  EMPTY_PROJECT,
  fromDatetimeLocalValue,
  getShipLockReason,
  getReshipUpdateValidationError,
  isReshipEligibleProject,
  journalEntryToForm,
  throwShipConfetti,
} from "../utils/projectHelpers.js";
import "./ProjectsPage.css";

const PROJECTS_PER_PAGE = 4;

export function ProjectsPage() {
  const { reload: reloadAuth } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [selectedProject, setSelectedProject] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [journalProject, setJournalProject] = useState(null);
  const [journalEntries, setJournalEntries] = useState([]);
  const [journalForm, setJournalForm] = useState(EMPTY_JOURNAL_ENTRY);
  const [editingJournalEntryId, setEditingJournalEntryId] = useState(null);
  const [hackatimeAvailable, setHackatimeAvailable] = useState(false);
  const [hackatimeConnected, setHackatimeConnected] = useState(false);
  const [hackatimeProjects, setHackatimeProjects] = useState([]);
  const [stackLaunched, setStackLaunched] = useState(false);
  const [hoursReductionWarnings, setHoursReductionWarnings] = useState([]);

  const mergeProjectIntoLists = useCallback((freshProject) => {
    if (!freshProject?.id) return;
    setProjects((current) => current.map((project) => (project.id === freshProject.id ? freshProject : project)));
    setSelectedProject((current) => (current?.id === freshProject.id ? freshProject : current));
    setJournalProject((current) => (current?.id === freshProject.id ? freshProject : current));
  }, []);

  const loadProjects = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/projects", { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load projects.");
      const nextProjects = data.projects || [];
      setProjects(nextProjects);
      setHoursReductionWarnings(data.hoursReductionWarnings || []);
      setHackatimeAvailable(Boolean(data.hackatimeAvailable));
      setSelectedProject((current) => {
        if (!current?.id) return current;
        return nextProjects.find((project) => project.id === current.id) ?? current;
      });
      setJournalProject((current) => {
        if (!current?.id) return current;
        return nextProjects.find((project) => project.id === current.id) ?? current;
      });
    } catch (err) {
      setError(err.message || "Failed to load projects.");
    } finally {
      setLoading(false);
      reloadAuth();
    }
  }, [reloadAuth]);

  const loadHackatimeStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/hackatime/status", { credentials: "include" });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.configured === "boolean") {
        setHackatimeAvailable(data.configured);
      }
      setHackatimeConnected(Boolean(data.connected));
      setHackatimeProjects(data.projects || []);
      setStackLaunched(Boolean(data.stackLaunched));
    } catch {
      // keep hackatimeAvailable from /api/projects when status fetch fails
    }
  }, []);

  const refreshHackatimeHours = useCallback(async () => {
    try {
      const response = await apiFetch("/api/hackatime/refresh", { method: "POST" });
      if (!response.ok) return;
      const data = await response.json();
      if (data.projects) {
        setProjects(data.projects);
        setSelectedProject((current) => {
          if (!current?.id) return current;
          return data.projects.find((project) => project.id === current.id) ?? current;
        });
        setJournalProject((current) => {
          if (!current?.id) return current;
          return data.projects.find((project) => project.id === current.id) ?? current;
        });
      }
      if (data.hackatimeProjects) setHackatimeProjects(data.hackatimeProjects);
    } catch {
      // keep last cached values
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadHackatimeStatus();
  }, [loadProjects, loadHackatimeStatus]);

  useEffect(() => {
    if (!editingProject) return;
    refreshHackatimeHours();
  }, [editingProject?.id ?? "new", refreshHackatimeHours]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setSelectedProject(null);
        setEditingProject(null);
        setJournalProject(null);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  const pageCount = Math.max(1, Math.ceil(projects.length / PROJECTS_PER_PAGE) || 1);

  const pageProjects = useMemo(() => {
    const start = page * PROJECTS_PER_PAGE;
    return projects.slice(start, start + PROJECTS_PER_PAGE);
  }, [page, projects]);

  const isLastPage = page >= pageCount - 1;
  const showAddCard = isLastPage;
  const showNext = !loading && projects.length > PROJECTS_PER_PAGE && page < pageCount - 1;

  useEffect(() => {
    if (page > pageCount - 1) {
      setPage(Math.max(0, pageCount - 1));
    }
  }, [page, pageCount]);

  function handleNext() {
    setPage((current) => Math.min(pageCount - 1, current + 1));
  }

  function openCreateProject() {
    setEditingProject({ ...EMPTY_PROJECT, hackatimeNames: [] });
    setError("");
  }

  async function openProjectDetails(project) {
    if (project.id) {
      try {
        const response = await fetch(`/api/projects/${project.id}`, { credentials: "include" });
        if (response.ok) {
          const data = await response.json();
          if (data.project) {
            mergeProjectIntoLists(data.project);
            setSelectedProject(data.project);
            return;
          }
        }
      } catch {
        // fall back to cached row
      }
    }
    setSelectedProject(project);
  }

  function openEditProject(project) {
    setSelectedProject(null);
    setEditingProject({ ...project, hackatimeNames: project.hackatimeNames || [] });
    setError("");
  }

  function resetJournalForm() {
    setEditingJournalEntryId(null);
    setJournalForm(EMPTY_JOURNAL_ENTRY);
  }

  async function openJournal(project) {
    setJournalProject(project);
    resetJournalForm();
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/journal_entries`, { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load journal entries.");
      setJournalEntries(data.entries || []);
    } catch (err) {
      setJournalEntries([]);
      setError(err.message);
    }
  }

  async function saveProject() {
    if (!editingProject) return;

    const validationError = validateProjectForm(editingProject, projects);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    const isNew = !editingProject.id;

    try {
      const response = await apiFetch(isNew ? "/api/projects" : `/api/projects/${editingProject.id}`, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(editingProject),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save project.");

      setEditingProject(null);
      mergeProjectIntoLists(data.project);
      setSelectedProject(data.project);
      await refreshHackatimeHours();
      await loadProjects();
    } catch (err) {
      setError(err.message || "Failed to save project.");
    }
  }

  async function saveJournalEntry(event) {
    event.preventDefault();
    if (!journalProject) return;

    if (!journalDescriptionMediaIsCdnOnly(journalForm.description)) {
      setError("Attachments must be Hack Club CDN links from #cdn on Slack.");
      return;
    }

    setError("");
    const hoursWorked = Number.parseFloat(journalForm.hoursWorked) || 0;
    if (hoursWorked < 0) {
      setError("Hours worked cannot be negative.");
      return;
    }

    const toolsUsed = journalForm.toolsUsed
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);

    const payload = {
      timeDone: fromDatetimeLocalValue(journalForm.timeDone),
      hoursWorked,
      description: journalForm.description,
      toolsUsed,
    };

    try {
      const isEditing = Boolean(editingJournalEntryId);
      const response = await apiFetch(
        isEditing
          ? `/api/projects/${journalProject.id}/journal_entries/${editingJournalEntryId}`
          : `/api/projects/${journalProject.id}/journal_entries`,
        {
          method: isEditing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save journal entry.");

      resetJournalForm();
      setJournalEntries((current) =>
        isEditing ? current.map((entry) => (entry.id === data.entry.id ? data.entry : entry)) : [data.entry, ...current]
      );
      if (data.project) {
        mergeProjectIntoLists(data.project);
        reloadAuth();
      }
    } catch (err) {
      setError(err.message || "Failed to save journal entry.");
    }
  }

  async function deleteProject(project) {
    if (!project?.id || !window.confirm(`Delete ${project.name}?`)) return;

    setError("");
    try {
      const response = await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw new Error(data.error || "Failed to delete project.");
      setSelectedProject(null);
      setEditingProject(null);
      setJournalProject(null);
      await loadProjects();
    } catch (err) {
      setError(err.message || "Failed to delete project.");
    }
  }

  async function shipProject(project, reshipUpdate) {
    const lockReason = getShipLockReason(project);
    if (lockReason) {
      setError(lockReason);
      return;
    }

    const reshipUpdateError = isReshipEligibleProject(project)
      ? getReshipUpdateValidationError(reshipUpdate)
      : null;
    if (reshipUpdateError) {
      setError(reshipUpdateError);
      return;
    }

    setError("");
    try {
      await refreshHackatimeHours();

      const response = await apiFetch(`/api/projects/${project.id}/ship`, {
        method: "POST",
        body: JSON.stringify(
          isReshipEligibleProject(project) ? { reshipUpdate: String(reshipUpdate || "").trim() } : {}
        ),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to ship project.");
      mergeProjectIntoLists(data.project);
      setSelectedProject(data.project);
      throwShipConfetti();
      await loadProjects();
    } catch (err) {
      setError(err.message || "Failed to ship project.");
    }
  }

  return (
    <PlatformLayout
      activeTab="projects"
      showNext={showNext}
      onNext={handleNext}
      nextLabel="Next projects page"
    >
      {loading ? <p className="platform-message">Loading projects…</p> : null}
      {error ? <p className="platform-message platform-message--error">{error}</p> : null}

      {!loading ? (
        <HoursReductionWarning
          warnings={hoursReductionWarnings}
          onAcknowledged={() => setHoursReductionWarnings([])}
        />
      ) : null}

      {!loading ? (
        <div className="projects-page">
          <div className="projects-page__grid">
            {pageProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => openProjectDetails(project)}
              />
            ))}
            {showAddCard ? <ProjectAddCard onClick={openCreateProject} /> : null}
          </div>
        </div>
      ) : null}

      {selectedProject ? (
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onEdit={() => openEditProject(selectedProject)}
          onJournal={() => openJournal(selectedProject)}
          onDelete={() => deleteProject(selectedProject)}
          onShip={(reshipUpdate) => shipProject(selectedProject, reshipUpdate)}
        />
      ) : null}

      {editingProject ? (
        <ProjectFormModal
          project={editingProject}
          hackatimeAvailable={hackatimeAvailable}
          hackatimeConnected={hackatimeConnected}
          hackatimeProjects={hackatimeProjects}
          stackLaunched={stackLaunched}
          onChange={(field, value) => {
            setEditingProject((current) => {
              const next = { ...current, [field]: value };
              if (field === "hackatimeNames") {
                next.hackatimeHours = undefined;
              }
              return next;
            });
          }}
          onClose={() => setEditingProject(null)}
          onSubmit={saveProject}
        />
      ) : null}

      {journalProject ? (
        <JournalModal
          project={journalProject}
          entries={journalEntries}
          form={journalForm}
          editingEntryId={editingJournalEntryId}
          onChange={(field, value) => {
            if (field === "hoursWorked" && value) {
              const numValue = Number(value);
              if (numValue < 0) return;
            }
            setJournalForm((current) => ({ ...current, [field]: value }));
          }}
          onEditEntry={(entry) => {
            setEditingJournalEntryId(entry.id);
            setJournalForm(journalEntryToForm(entry));
            setError("");
          }}
          onCancelEdit={resetJournalForm}
          onClose={() => setJournalProject(null)}
          onSubmit={saveJournalEntry}
        />
      ) : null}
    </PlatformLayout>
  );
}
