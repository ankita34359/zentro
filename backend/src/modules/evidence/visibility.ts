import type { Capabilities } from "../permissions/service.js";
import type { EvidenceRow } from "./repositories/evidence.js";

/**
 * Who may see a piece of evidence (docs/permission-model.md): the person who submitted it always; the person it is about, unless it
 * is restricted; `organization` evidence by anyone holding `evidence.view`; `scope` evidence by people whose `evidence.view` reaches
 * the person it is about (or, with none named, the submitter); `restricted` only by people whose `evidence.view_restricted` reaches them.
 */
export function evidenceVisible(caps: Capabilities, me: string, e: Pick<EvidenceRow, "submitted_by_membership_id" | "related_membership_id" | "confidentiality">): boolean {
  if (e.submitted_by_membership_id === me) return true;
  const subject = e.related_membership_id ?? e.submitted_by_membership_id;
  const covers = (key: string): boolean => {
    const s = caps.scope(key);
    return s.all || s.members.has(subject);
  };
  if (e.confidentiality === "restricted") return covers("evidence.view_restricted");
  if (e.related_membership_id === me) return true;
  if (e.confidentiality === "organization") return caps.has("evidence.view");
  return covers("evidence.view");
}
