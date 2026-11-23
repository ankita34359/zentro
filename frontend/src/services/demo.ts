import { api } from "@/services/api";
import type { Me } from "@/services/auth";

export interface DemoStatus { loaded: boolean; loadedAt: string | null; counts: Record<string, number>; realPeople: number }
export interface Persona { id: string; name: string; designation: string | null; department: string | null; roles: string[]; group: "leadership" | "heads" | "managers" | "employees" }
export interface Blocker { kind: string; count: number; message: string }

export const getDemoStatus = () => api<DemoStatus>("/api/demo/status");
export const loadDemo = () => api<DemoStatus>("/api/demo/load", { method: "POST" });
export const removeDemo = () => api<DemoStatus>("/api/demo/remove", { method: "POST" });
export const getPersonas = () => api<Persona[]>("/api/demo/personas");
export const viewAs = (membershipId: string) => api<{ viewingAs: string; me: Me }>(`/api/demo/view-as/${membershipId}`, { method: "POST" });
export const stopViewing = () => api<Me | { signedOut: true }>("/api/demo/stop-viewing", { method: "POST" });
