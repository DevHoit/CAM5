"use client";

import type { ComponentType } from "react";

export function MetricCard({
  label,
  value,
  unit,
  note,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  tone: "blue" | "amber" | "red" | "green";
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-card-head">
        <span className="eyebrow">{label}</span>
        <span className="metric-icon"><Icon size={19} strokeWidth={2} /></span>
      </div>
      <div className="metric-value">{value}<span>{unit}</span></div>
      <p className="metric-note">{note}</p>
    </article>
  );
}
