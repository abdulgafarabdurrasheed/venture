import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CDN_UPLOAD_HELP,
  journalDescriptionMediaIsCdnOnly,
  markdownImageForCdnUrl,
} from "../utils/cdnLinks.js";
import { JournalDescription } from "./JournalDescription.jsx";
import "./JournalModal.css";

function ModalShell({ title, onClose, children, className = "" }) {
  return createPortal(
    <div className="journal-modal__overlay" role="presentation" onClick={onClose}>
      <section
        className={`journal-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="journal-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="journal-modal__title">{title}</h2>
        {children}
      </section>
    </div>,
    document.body
  );
}

export function JournalModal({
  project,
  entries,
  form,
  editingEntryId,
  onChange,
  onEditEntry,
  onCancelEdit,
  onClose,
  onSubmit,
}) {
  const [linkError, setLinkError] = useState("");
  const [cdnLinkInput, setCdnLinkInput] = useState("");
  const textareaRef = useRef(null);
  const descriptionRef = useRef(form.description);
  descriptionRef.current = form.description;

  function insertCdnLink() {
    const mdLink = markdownImageForCdnUrl(cdnLinkInput);
    if (!mdLink) {
      setLinkError("Paste a Hack Club CDN link from #cdn on Slack.");
      return;
    }

    setLinkError("");
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? descriptionRef.current.length;
    const end = textarea?.selectionEnd ?? start;
    const before = descriptionRef.current.slice(0, start);
    const after = descriptionRef.current.slice(end);
    const next = `${before}${mdLink}${after}`;
    onChange("description", next);
    descriptionRef.current = next;
    setCdnLinkInput("");
  }

  return (
    <ModalShell title={`${project.name} — Journal`} onClose={onClose} className="journal-modal--wide">
      {editingEntryId ? <p className="journal-modal__edit-hint">Editing an unshipped journal entry.</p> : null}

      <form
        className="journal-modal__form"
        onSubmit={(event) => {
          if (!journalDescriptionMediaIsCdnOnly(form.description)) {
            event.preventDefault();
            setLinkError("Attachments must be Hack Club CDN links from #cdn on Slack.");
            return;
          }
          onSubmit(event);
        }}
      >
        <label>
          Time done
          <input
            type="datetime-local"
            value={form.timeDone}
            onChange={(event) => onChange("timeDone", event.target.value)}
          />
        </label>
        <label>
          Hours worked
          <input
            type="number"
            min="0"
            step="0.25"
            value={form.hoursWorked}
            onChange={(event) => onChange("hoursWorked", event.target.value)}
            required
          />
        </label>
        <label>
          Description
          <p className="journal-modal__cdn-hint">{CDN_UPLOAD_HELP}</p>
          <textarea
            ref={textareaRef}
            value={form.description}
            onChange={(event) => onChange("description", event.target.value)}
            required
            placeholder="Describe what you worked on…"
          />
          <div className="journal-modal__cdn-row">
            <input
              type="url"
              className="journal-modal__cdn-input"
              value={cdnLinkInput}
              onChange={(event) => {
                setCdnLinkInput(event.target.value);
                setLinkError("");
              }}
              placeholder="https://cdn.hackclub.com/…"
            />
            <button type="button" onClick={insertCdnLink}>
              Add media link
            </button>
          </div>
          {linkError ? <p className="journal-modal__error">{linkError}</p> : null}
          <small className="journal-modal__hint">Inserts an image or video line into your description.</small>
        </label>
        <label>
          Tools used
          <input
            value={form.toolsUsed}
            onChange={(event) => onChange("toolsUsed", event.target.value)}
            placeholder="React, Figma, CAD"
          />
        </label>
        <button type="submit" className="journal-modal__submit">
          {editingEntryId ? "Update entry" : "Save entry"}
        </button>
        {editingEntryId ? (
          <button type="button" className="journal-modal__cancel-edit" onClick={onCancelEdit}>
            Cancel edit
          </button>
        ) : null}
      </form>

      <section className="journal-modal__list" aria-label="Journal entries">
        <h3>Journal entries</h3>
        {entries.length === 0 ? (
          <p className="journal-modal__empty">No journal entries yet.</p>
        ) : (
          entries.map((entry) => (
            <article className="journal-modal__entry" key={entry.id}>
              <div className="journal-modal__entry-header">
                <strong>
                  {entry.timeDone ? new Date(entry.timeDone).toLocaleDateString() : "N/A"} — {entry.hoursWorked || 0}{" "}
                  hrs
                </strong>
                {entry.editable ? (
                  <button
                    type="button"
                    className="journal-modal__edit-btn"
                    onClick={() => onEditEntry(entry)}
                    disabled={editingEntryId === entry.id}
                  >
                    {editingEntryId === entry.id ? "Editing…" : "Edit"}
                  </button>
                ) : null}
              </div>
              <JournalDescription text={entry.description} />
              {entry.toolsUsed?.length ? <small>Tools: {entry.toolsUsed.join(", ")}</small> : null}
            </article>
          ))
        )}
      </section>
    </ModalShell>
  );
}
