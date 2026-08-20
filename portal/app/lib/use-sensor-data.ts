"use client";

// La implementación vive en cam5-data.tsx, que decide entre la API y los datos
// de demostración. Este archivo se conserva para no romper los imports.
export { useSensorData } from "./cam5-data";
export type { PortalSensor } from "./use-cam5";
