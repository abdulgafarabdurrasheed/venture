import { useEffect, useRef } from "react";
import "./SignupWelcomeModal.css";

export function SignupWelcomeModal({ open, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="signup-welcome" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="signup-welcome__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-welcome-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="signup-welcome__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="signup-welcome-title" className="signup-welcome__title">
          Thanks for signin up!
        </h2>
        <p className="signup-welcome__text">
          Come back on <strong>June 15th</strong> to enter the platform.
        </p>
        <p className="signup-welcome__text">
          You can already start logging your hours!
        </p>
        <p className="signup-welcome__link-line">
          <a href="/rules" onClick={onClose}>
            See how here
          </a>
        </p>
        <button type="button" className="signup-welcome__ok" onClick={onClose}>
          Got it!
        </button>
      </div>
    </div>
  );
}
