"use client";

import { useEffect, useState } from "react";

const STORAGE_SYNC_EVENT = "cam5:storage-sync";

/**
 * Persistencia temporal del prototipo. Mantiene el contrato de React.useState
 * para que la futura capa API pueda reemplazarla sin cambiar los componentes.
 */
export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);
    } catch {
      // Si el navegador bloquea el almacenamiento, el front continúa en memoria.
    } finally {
      setReady(true);
    }
  }, [key]);

  useEffect(() => {
    const syncValue = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: T }>).detail;
      if (detail?.key === key) setValue(detail.value);
    };
    window.addEventListener(STORAGE_SYNC_EVENT, syncValue);
    return () => window.removeEventListener(STORAGE_SYNC_EVENT, syncValue);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent(STORAGE_SYNC_EVENT, { detail: { key, value } }));
    } catch {
      // El modo privado o una cuota agotada no deben bloquear la interfaz.
    }
  }, [key, ready, value]);

  return [value, setValue] as const;
}
