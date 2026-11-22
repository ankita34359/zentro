import { LogIn, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/** Header: who is signed in and a Log out action; a Sign in link when nobody is. Shows the name on wide screens, an initial on phones. */
export function UserMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.status === "loading" || auth.status === "error") return null;
  if (!auth.me) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to="/login">
          <LogIn aria-hidden="true" /> Sign in
        </Link>
      </Button>
    );
  }
  const { user, organization } = auth.me;
  return (
    <div className="flex items-center gap-2" data-testid="user-menu">
      <span className="hidden min-w-0 text-right leading-tight sm:block">
        <span className="block max-w-[14rem] truncate text-label font-medium">{user.name}</span>
        <span className="block max-w-[14rem] truncate text-caption text-muted-foreground">{organization?.name ?? user.email}</span>
      </span>
      <span
        role="img"
        aria-label={`Signed in as ${user.name}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-label font-semibold text-primary-soft-foreground sm:hidden"
      >
        {user.name.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Log out"
        onClick={() => void auth.logout().then(() => navigate("/login", { replace: true }))}
      >
        <LogOut aria-hidden="true" /> <span className="hidden sm:inline">Log out</span>
      </Button>
    </div>
  );
}
