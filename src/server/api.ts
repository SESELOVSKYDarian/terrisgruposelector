import "server-only";

import { getCurrentProfile, type SessionProfile } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/responses";

export class ApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function requireProfile(): Promise<SessionProfile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new ApiError("No autenticado.", 401);
  return profile;
}

export function forbid(message = "No tenés permiso para esta acción."): never {
  throw new ApiError(message, 403);
}

/** Runs a route body and maps thrown errors to JSON responses (ApiError keeps its status). */
export async function handle(body: () => Promise<unknown>) {
  try {
    return ok((await body()) ?? {});
  } catch (error) {
    if (error instanceof ApiError) return fail(error.message, error.status);
    console.error(error);
    return fail(error instanceof Error ? error.message : "Error inesperado.", 500);
  }
}

/** Parses a JSON body against a Zod schema; malformed payloads are 422s, never 500s. */
export async function parseBody<T>(request: Request, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("Solicitud inválida.", 422);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("Los datos enviados no son válidos.", 422);
  return parsed.data;
}
