import { useEffect, useState } from "react";
import { getActiveShipCountdown } from "../constants/shipDeadlines.js";
import { getTimeLeft, padCountdown } from "../utils/countdown.js";
import "./ShipCountdown.css";

function CountdownUnit({ value, label }) {
  return (
    <div className="ship-countdown__unit">
      <span key={value} className="ship-countdown__num">{value}</span>
      <span className="ship-countdown__unit-label">{label}</span>
    </div>
  );
}

export function ShipCountdown({ variant = "default" }) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const active = getActiveShipCountdown(tick);
  if (!active) return null;

  const timeLeft = getTimeLeft(active.target, tick);
  if (timeLeft.expired) return null;

  const className = variant === "bar" ? "ship-countdown ship-countdown--bar" : "ship-countdown";
  const timerLabel = `${active.label} (${active.deadlineNote})`;

  return (
    <div className={className} role="timer" aria-live="polite" aria-atomic="true">
      <p className="ship-countdown__heading">
        <span className="ship-countdown__label">{active.label}</span>
        {variant !== "bar" ? <span className="ship-countdown__note">{active.deadlineNote}</span> : null}
      </p>
      <div className="ship-countdown__timer" aria-label={timerLabel}>
        <CountdownUnit value={String(timeLeft.days)} label="days" />
        <span className="ship-countdown__sep" aria-hidden="true">:</span>
        <CountdownUnit value={padCountdown(timeLeft.hours)} label="hrs" />
        <span className="ship-countdown__sep" aria-hidden="true">:</span>
        <CountdownUnit value={padCountdown(timeLeft.minutes)} label="min" />
        <span className="ship-countdown__sep" aria-hidden="true">:</span>
        <CountdownUnit value={padCountdown(timeLeft.seconds)} label="sec" />
      </div>
    </div>
  );
}
