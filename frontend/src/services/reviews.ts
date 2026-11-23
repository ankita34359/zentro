import { api } from "@/services/api";

export interface ReviewView {
  id: string;
  period: { id: string; name: string };
  subject: { id: string; name: string };
  reviewer: { id: string; name: string };
  status: "draft" | "submitted" | "acknowledged";
  rating: number | null;
  sharedSummary: string;
  developmentFocus: string;
  /** Present only for the reviewer and people allowed to read private notes. */
  privateNotes?: string;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  can: { edit: boolean; acknowledge: boolean };
}
export interface ReviewDraft { rating?: number | null; sharedSummary?: string; developmentFocus?: string; privateNotes?: string; submit?: boolean }
export const listReviews = (periodId: string, subjectId: string) => api<ReviewView[]>(`/api/performance/reviews?periodId=${encodeURIComponent(periodId)}&subjectId=${encodeURIComponent(subjectId)}`);
export const createReview = (b: ReviewDraft & { periodId: string; subjectId: string }) => api<ReviewView>("/api/performance/reviews", { method: "POST", body: b });
export const updateReview = (id: string, b: ReviewDraft) => api<ReviewView>(`/api/performance/reviews/${id}`, { method: "PATCH", body: b });
export const acknowledgeReview = (id: string) => api<ReviewView>(`/api/performance/reviews/${id}/acknowledge`, { method: "POST" });
