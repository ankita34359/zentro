import { Clock } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { NAV_GROUP_LABELS, NAV_ITEMS } from "@/routes/navigation";
import { SECTIONS } from "./sections";

/** Honest placeholder for a section whose real page is built in a later stage. */
export default function SectionPage({ sectionKey }: { sectionKey: string }) {
  const nav = NAV_ITEMS.find((n) => n.key === sectionKey);
  const section = SECTIONS[sectionKey];
  if (!nav || !section) return null;
  return (
    <>
      <PageHeader title={nav.label} description={nav.description} eyebrow={NAV_GROUP_LABELS[nav.group] ?? "Workspace"} />
      <EmptyState illustration={section.illustration} title={section.title}>
        <p>{section.body}</p>
        <p className="mt-4">
          <Badge variant="outline">
            <Clock aria-hidden="true" /> Planned for stage {section.stage}
          </Badge>
        </p>
      </EmptyState>
    </>
  );
}
