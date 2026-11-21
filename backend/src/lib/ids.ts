import crypto from "node:crypto";

/** Entity ids are text UUIDs generated in the app (decision D15). */
export const newId = (): string => crypto.randomUUID();

/** Short id for tracing one request through the logs and the error envelope. */
export const newRequestId = (): string => `req_${crypto.randomBytes(6).toString("hex")}`;

const INCOMING_OK = /^[A-Za-z0-9_-]{8,64}$/;
/** Accept a caller-supplied X-Request-Id only if it is short and harmless; otherwise make our own. */
export const requestIdFrom = (incoming: string | undefined): string =>
  incoming && INCOMING_OK.test(incoming) ? incoming : newRequestId();
