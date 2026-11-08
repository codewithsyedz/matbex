import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, Send, X, Loader2, Image as ImageIcon, FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  onUploadAttachment: (file: File) => Promise<{ url: string; type: string; name: string }>;
  onSendAttachment: (attachment: { url: string; type: string; name: string }, content?: string) => void;
  disabled?: boolean;
}

export function ChatInput({ 
  onSendMessage, 
  onUploadAttachment, 
  onSendAttachment,
  disabled 
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<{ url: string; type: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (disabled) return;
    
    if (attachment) {
      onSendAttachment(attachment, message.trim() || undefined);
      setAttachment(null);
      setPreviewUrl(null);
    } else if (message.trim()) {
      onSendMessage(message.trim());
    }
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Show local preview for images
    if (file.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    }
    
    setUploading(true);
    try {
      const uploaded = await onUploadAttachment(file);
      setAttachment(uploaded);
    } catch (error) {
      console.error("Upload failed:", error);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    setPreviewUrl(null);
  };

  const canSend = (message.trim() || attachment) && !uploading && !disabled;
  const isImage = attachment?.type.startsWith("image/");

  return (
    <div className="border-t p-4">
      {/* Attachment Preview */}
      {(previewUrl || attachment) && (
        <div className="mb-3 relative inline-block">
          {isImage && previewUrl ? (
            <div className="relative">
              <img 
                src={previewUrl} 
                alt="Attachment preview" 
                className="h-24 w-auto rounded-lg object-cover"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={removeAttachment}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : attachment ? (
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 pr-8 relative">
              <FileIcon className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm truncate max-w-[200px]">{attachment.name}</span>
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={removeAttachment}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : null}
          {uploading && (
            <div className="absolute inset-0 bg-background/80 rounded-lg flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
        />
        
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || disabled}
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        
        <Textarea
          placeholder="Type a message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[44px] max-h-32 resize-none"
          rows={1}
          disabled={disabled}
        />
        
        <Button
          size="icon"
          className="shrink-0"
          onClick={handleSend}
          disabled={!canSend}
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
