import { lazyWithPreload } from "@/lib/preload";

// Pages load on demand (one small chunk each), so the first paint only pays for the shell. Each one can also be
// preloaded (see AppShell), so by the time someone opens a section its chunk is usually already in memory.
export const OverviewPage = lazyWithPreload(() => import("@/pages/OverviewPage"));
export const SectionPage = lazyWithPreload(() => import("@/pages/SectionPage"));
export const NotFoundPage = lazyWithPreload(() => import("@/pages/NotFoundPage"));
export const DesignPage = lazyWithPreload(() => import("@/pages/DesignPage"));

export const LoginPage = lazyWithPreload(() => import("@/pages/auth/LoginPage"));
export const RegisterPage = lazyWithPreload(() => import("@/pages/auth/RegisterPage"));
export const OnboardingPage = lazyWithPreload(() => import("@/pages/auth/OnboardingPage"));

export const ForgotPasswordPage = lazyWithPreload(() => import("@/pages/auth/ForgotPasswordPage"));
export const ResetPasswordPage = lazyWithPreload(() => import("@/pages/auth/ResetPasswordPage"));
export const AcceptInvitePage = lazyWithPreload(() => import("@/pages/auth/AcceptInvitePage"));
export const SettingsPage = lazyWithPreload(() => import("@/pages/settings/SettingsPage"));
export const UsersPage = lazyWithPreload(() => import("@/pages/settings/UsersPage"));
export const RolesPage = lazyWithPreload(() => import("@/pages/settings/RolesPage"));
export const StructurePage = lazyWithPreload(() => import("@/pages/settings/StructurePage"));
export const AuditPage = lazyWithPreload(() => import("@/pages/settings/AuditPage"));
export const ProfilePage = lazyWithPreload(() => import("@/pages/settings/ProfilePage"));

/** Every page a visitor can reach from the sidebar. The unlisted /design style guide is left out on purpose. */
export const PREFETCH_PAGES = [OverviewPage, SectionPage, NotFoundPage];
