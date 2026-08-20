"use client";

import { IconSearch as Search } from "@tabler/icons-react";

export function TableEmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="table-empty-state"><Search size={21} /><div><strong>{title}</strong><p>{detail}</p></div></div>;
}
