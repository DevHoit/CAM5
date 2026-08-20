import type { NextConfig } from "next";

// El portal se sirve bajo una ruta del dominio (hoitlive.com/cam5), no en un
// subdominio. `basePath` hace que Next genere sus rutas y assets bajo ese
// prefijo, de modo que el proxy no tenga que reescribir nada del portal.
//
// Vacío = raíz del dominio, útil en desarrollo local.
const basePath = process.env.NEXT_PUBLIC_CAM5_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // Imagen de Docker mínima: incluye sólo las dependencias que el build usa.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
