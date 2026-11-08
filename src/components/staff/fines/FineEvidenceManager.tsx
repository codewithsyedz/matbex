import { useRef } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Eye, Loader2, Paperclip, Trash2, AlertTriangle } from "lucide-react";
import { useFineEvidence, openFineEvidence } from "@/hooks/useFineEvidence";

interface Props {
  fineId: string;
  requiresEvidence?: boolean;
  canManage?: boolean;
  legacyPath?: string | null;
}

const fmtSize = (bytes?: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function FineEvidenceManager({ fineId, requiresEvidence, canManage = true, legacyPath }: Props) {
  const { attachments, isLoading, uploadFiles, removeFile } = useFineEvidence(fineId);
  const inputRef = useRef<HTMLInputElement>(null);

  const empty = attachments.length === 0 && !legacyPath;

  return (
    <div className="space-y-3">
      {requiresEvidence && empty && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This violation type requires supporting evidence. The fine cannot be submitted or
            approved until at least one attachment is uploaded.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="space-y-2">
          {legacyPath && (
            <div className="flex items-center justify-between rounded-md border border-border/50 p-2">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">Original evidence file</span>
                <Badge variant="outline" className="text-[10px]">legacy</Badge>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openFineEvidence(legacyPath)}>
                  <Eye className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openFineEvidence(legacyPath, true)}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-md border border-border/50 p-2">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm">{a.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtSize(a.file_size)} · {format(new Date(a.created_at), "dd MMM yyyy HH:mm")}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openFineEvidence(a.storage_path)}>
                  <Eye className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openFineEvidence(a.storage_path, true)}>
                  <Download className="h-4 w-4" />
                </Button>
                {canManage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    disabled={removeFile.isPending}
                    onClick={() => removeFile.mutate(a)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}

          {empty && (
            <p className="text-sm text-muted-foreground">No evidence attached yet.</p>
          )}
        </div>
      )}

      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) uploadFiles.mutate({ files });
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={uploadFiles.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {uploadFiles.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            Upload evidence
          </Button>
        </>
      )}
    </div>
  );
}
