/**
 * THE ONE PLACE EMAIL WILL PLUG IN (stage 8).
 *
 * In stage 2.2 nothing is emailed: an administrator copies the invitation link or the password-reset link from the
 * screen and sends it themselves (owner decision, open question 8: "not now"). When the outbox and the viaSocket
 * email flow arrive (stage 8), a delivery that enqueues an email replaces `noDelivery` below; nothing else in the
 * auth module needs to change. A delivery receives the SECRET link parts only for the moment of sending: it must not
 * log them, and the database never stores them (only their hashes).
 */
export interface LinkDelivery {
  /** An invitation was created or regenerated. `code` is the secret; the link is `<site>/accept-invite#code=<code>`. */
  invitationIssued(info: { organizationId: string; invitationId: string; email: string; code: string; expiresAt: string }): void;
  /** An administrator generated a reset link. `token` is the secret; the link is `<site>/reset-password#token=<token>`. */
  passwordResetIssued(info: { userId: string; token: string; expiresAt: string }): void;
  /** Someone used "Forgot password". Whether the address has an account is never revealed to the caller. */
  passwordResetRequested(info: { email: string }): void;
}

/** Stage 2.2: nothing is sent. Administrators copy links. */
export const noDelivery: LinkDelivery = {
  invitationIssued: () => undefined,
  passwordResetIssued: () => undefined,
  passwordResetRequested: () => undefined,
};
