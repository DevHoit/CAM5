import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { q, one } from "./db.ts";
import { ApiError } from "./errors.ts";

const SKEW_MS = 300_000; // ±5 min, protección contra reenvío

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type GatewayIdentity = {
  id: string;
  site_id: string;
  hmac_secret: string;
  config_version: number;
  enabled: boolean;
};

/**
 * Autentica al gateway: clave portadora + firma HMAC opcionalmente exigida.
 * Acepta dos claves simultáneas (activa y siguiente) para permitir rotación
 * sin ventana de corte, tal como lo describe la especificación del gateway.
 */
export async function authenticateGateway(
  headers: Record<string, any>,
  rawBody: string,
  method: string,
  path: string
): Promise<GatewayIdentity> {
  const authorization = String(headers["authorization"] ?? "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Falta la credencial del gateway");

  const hash = sha256(token);
  const gateway = await one<GatewayIdentity>(
    `SELECT id, site_id, hmac_secret, config_version, enabled
       FROM gateway
      WHERE api_key_hash = $1 OR api_key_hash_next = $1`,
    [hash]
  );
  if (!gateway) throw new ApiError(401, "UNAUTHORIZED", "Credencial de gateway desconocida");
  if (!gateway.enabled) throw new ApiError(403, "GATEWAY_DISABLED", "El gateway está deshabilitado");

  const declaredId = headers["x-cam5-gateway-id"];
  if (declaredId && declaredId !== gateway.id) {
    throw new ApiError(403, "GATEWAY_MISMATCH", "La credencial no corresponde al gateway declarado");
  }

  const requireSignature = process.env.CAM5_REQUIRE_HMAC !== "false";
  const signature = headers["x-cam5-signature"];
  const timestamp = headers["x-cam5-timestamp"];

  if (requireSignature || signature) {
    if (!signature || !timestamp) {
      throw new ApiError(401, "SIGNATURE_REQUIRED", "Faltan X-CAM5-Signature o X-CAM5-Timestamp");
    }
    const sent = Date.parse(String(timestamp));
    if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > SKEW_MS) {
      throw new ApiError(401, "TIMESTAMP_SKEW", "X-CAM5-Timestamp fuera de la ventana permitida");
    }
    const stringToSign = `${method}\n${path}\n${timestamp}\n${sha256(rawBody)}`;
    const expected = "v1=" + createHmac("sha256", gateway.hmac_secret).update(stringToSign).digest("hex");
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ApiError(401, "BAD_SIGNATURE", "Firma HMAC inválida");
    }
  }

  return gateway;
}

/** Autenticación de usuario del portal. Sustituir por la sesión real en Fase 7. */
export async function currentUser(headers: Record<string, any>) {
  const email = headers["x-cam5-user"] ?? process.env.CAM5_DEV_USER;
  if (!email) throw new ApiError(401, "UNAUTHORIZED", "Sesión no iniciada");
  const user = await one(
    `SELECT id, email, full_name, role, status FROM app_user WHERE email = $1`,
    [String(email)]
  );
  if (!user) throw new ApiError(401, "UNAUTHORIZED", "Usuario desconocido");
  if (user.status !== "active") throw new ApiError(403, "USER_SUSPENDED", "Usuario suspendido");
  return user;
}

export function requireRole(user: any, allowed: string[]) {
  if (!allowed.includes(user.role)) {
    throw new ApiError(403, "FORBIDDEN", `El rol ${user.role} no puede ejecutar esta acción`);
  }
}
