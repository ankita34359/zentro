/** One error type for everything the API refuses on purpose. Messages must never contain secrets, SQL or other tenants' data. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const unauthenticated = (message = "Sign in required") => new HttpError(401, "unauthenticated", message);
export const permissionDenied = (message = "Not allowed") => new HttpError(403, "permission_denied", message);
export const validationFailed = (details: { path: string; message: string }[]) =>
  new HttpError(400, "validation_failed", "Request did not pass validation", details);

/** Raised by the tenant-scoped repository when a statement or a returned row would cross organizations. */
export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolationError";
  }
}
