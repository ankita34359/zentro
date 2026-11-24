import type { NextFunction, Request, Response } from "express";

/**
 * The page may load code, styles, images and fonts only from Zentro itself, may not be put in a frame, may not send the
 * address of one page to another site, and may not use the camera, microphone or location. The built app has no inline
 * scripts and no outside resources, so this does not need 'unsafe-inline' for scripts. Styles keep 'unsafe-inline' because the
 * animation library and charts set style attributes.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  // only over https (behind Embarko's proxy the request is https): browsers ignore it on plain http, and it must never be sent from a developer's http page
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  next();
}
