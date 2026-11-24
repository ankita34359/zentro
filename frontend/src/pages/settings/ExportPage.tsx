import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormNotice } from "@/components/common/FormField";
import { PageHeader } from "@/components/common/PageHeader";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadExport, getExportInfo } from "@/services/system";

/** Settings → Export all data (administrators): the organization's own records as a zip of CSV files. */
export default function ExportPage() {
  const info = useQuery({ queryKey: ["export-info"], queryFn: getExportInfo, retry: false });
  const run = useMutation({
    mutationFn: downloadExport,
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
  return (
    <>
      <PageHeader eyebrow="System" title="Export all data" description="Download your organization's own records as a zip of spreadsheet (CSV) files. Only administrators can do this, and every export is recorded in the audit log." />
      {info.isPending ? <PageSkeleton /> : info.isError ? <ErrorState title="The export page could not be loaded" error={info.error} onRetry={() => void info.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>What is in the zip</CardTitle><CardDescription>One file for each kind of record, plus a README that says what each holds.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <ul aria-label="Files in the export" className="grid grid-cols-2 gap-x-4 gap-y-1 text-label">{info.data.files.map((f) => <li key={f}>{f}</li>)}</ul>
              <Button onClick={() => run.mutate()} disabled={run.isPending}><Download aria-hidden="true" /> {run.isPending ? "Preparing…" : "Download everything (zip)"}</Button>
              {run.isError && <FormAlert>{run.error instanceof Error ? run.error.message : "The export could not be made."}</FormAlert>}
              {run.isSuccess && <FormNotice>Your download has started. It was recorded in the audit log.</FormNotice>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Left out on purpose</CardTitle><CardDescription>These are never in an export.</CardDescription></CardHeader>
            <CardContent><ul aria-label="Not included" className="list-disc space-y-1 pl-5 text-label">{info.data.excluded.map((e) => <li key={e}>{e}</li>)}</ul></CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
