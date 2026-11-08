import { useRef, useState } from "react";
import { Paperclip, Check, Trash2, Loader2, FileText, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApplicationDocument, ApplicationDocType } from "@/hooks/useApplicationVerification";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description: string;
  acceptedFormats: string;
  acceptAttr: string;
  requirementsTitle?: string;
  requirements?: string[];
  doc?: ApplicationDocument;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function DocumentUploadStep({
  title,
  description,
  acceptedFormats,
  acceptAttr,
  requirementsTitle,
  requirements,
  doc,
  onUpload,
  onDelete,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setBusy(true);
    try {
      await onUpload(files[0]);
    } finally {
      setBusy(false);
    }
  };

  const sizeKb = doc?.size_bytes ? (doc.size_bytes / 1024).toFixed(0) : null;
  const isImage = doc?.mime_type?.startsWith("image/");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground leading-[1.2]">
          {title}
        </h1>
        <p className="text-[15px] text-muted-foreground leading-[1.6] mt-2">{description}</p>
      </div>

      <Card
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "border-2 border-dashed bg-background/40 rounded-xl p-10 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <Paperclip className="w-6 h-6 mx-auto text-muted-foreground mb-3" />
        <p className="text-[15px] font-medium text-foreground mb-1">Drag your file</p>
        <p className="text-[13px] text-muted-foreground mb-3">accepted formats {acceptedFormats}</p>
        <Button
          variant="link"
          className="text-primary text-[14px] h-auto p-0"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Upload from your device
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </Card>

      {doc && (
        <Card className="flex items-center gap-3 px-4 py-3">
          {isImage ? <ImageIcon className="w-5 h-5 text-muted-foreground" /> : <FileText className="w-5 h-5 text-muted-foreground" />}
          <a
            href={doc.file_url}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-[14px] text-foreground truncate hover:underline"
          >
            {doc.file_name}
          </a>
          {sizeKb && <span className="text-[12px] text-muted-foreground">{sizeKb} KB</span>}
          <span className={cn(
            "w-6 h-6 rounded-full flex items-center justify-center",
            doc.status === "approved" ? "bg-emerald-100 text-emerald-700" :
            doc.status === "rejected" ? "bg-red-100 text-red-700" :
            "bg-emerald-50 text-emerald-600"
          )}>
            <Check className="w-3.5 h-3.5" />
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={async () => {
              setBusy(true);
              try { await onDelete(); } finally { setBusy(false); }
            }}
            disabled={busy || doc.status === "approved"}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </Card>
      )}

      {doc?.status === "rejected" && doc.reviewer_note && (
        <Card className="bg-red-50 border-red-200 text-red-800 p-4 text-[14px] leading-[1.6]">
          <strong className="font-medium">Rejected:</strong> {doc.reviewer_note}
        </Card>
      )}

      {requirements && requirements.length > 0 && (
        <Card className="bg-blue-50/60 border-blue-100 p-5 text-[14px] leading-[1.65] text-foreground space-y-3">
          {requirementsTitle && <p className="font-medium">{requirementsTitle}</p>}
          <ul className="space-y-1.5 list-disc pl-5 text-muted-foreground">
            {requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}