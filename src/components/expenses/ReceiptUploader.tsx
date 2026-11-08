import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
export { ReceiptUploaderField as ReceiptUploader } from "./ReceiptUploaderField";

// Compact version for viewing receipts in tables
export function ReceiptThumbnail({ receiptUrl }: { receiptUrl: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Generate signed URL when needed
  useEffect(() => {
    const generateSignedUrl = async () => {
      if (!receiptUrl) {
        setSignedUrl(null);
        return;
      }
      
      // If it's already a signed URL, use it directly
      if (receiptUrl.includes('token=')) {
        setSignedUrl(receiptUrl);
        return;
      }
      
      setIsLoading(true);
      try {
        let filePath = receiptUrl;
        // Handle both formats: "expense-receipts/path" and full URLs
        if (receiptUrl.includes('expense-receipts/')) {
          filePath = receiptUrl.split('expense-receipts/').pop() || receiptUrl;
        }
        
        const { data, error } = await supabase.storage
          .from('expense-receipts')
          .createSignedUrl(filePath, 3600);
        
        if (error) {
          console.error('Error generating signed URL:', error);
          setSignedUrl(null);
          return;
        }
        
        setSignedUrl(data.signedUrl);
      } catch (err) {
        console.error('Error generating signed URL:', err);
        setSignedUrl(null);
      } finally {
        setIsLoading(false);
      }
    };
    
    generateSignedUrl();
  }, [receiptUrl]);

  if (!receiptUrl) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setIsOpen(true)}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ImageIcon className="h-4 w-4 text-primary" />
        )}
      </Button>

      {isOpen && signedUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setIsOpen(false)}
        >
          <div className="relative max-w-2xl max-h-[90vh]">
            <img
              src={signedUrl}
              alt="Receipt"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
