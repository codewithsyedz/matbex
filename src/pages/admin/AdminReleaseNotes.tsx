import { ReleaseNotesPanel } from "@/components/admin/ReleaseNotesPanel";

export default function AdminReleaseNotes() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-foreground">Release Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every shipped change, marked backend-only or requiring an Android terminal update.
        </p>
      </div>
      <ReleaseNotesPanel />
    </div>
  );
}
