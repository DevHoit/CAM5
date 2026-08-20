// Respuesta de error uniforme acordada en DATA_CONTRACTS.md
import { randomUUID } from "node:crypto";

export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors?: Record<string, string>;
  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function errorBody(error: ApiError, traceId = randomUUID()) {
  return { code: error.code, message: error.message, fieldErrors: error.fieldErrors ?? {}, traceId };
}
