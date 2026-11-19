import { useState } from "react";
import { db } from "@/integrations/db/client";

/** Storage bucket holding generated report exports (private, restaurant-scoped). */
const BUCKET = "report-exports";

export const SHARE_EXPIRY_OPTIONS = [
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "24 hours" },
  { value: 604800, label: "7 days" },
] as const;

export interface ShareableLink {
  url: string;
  path: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

/**
 * Uploads a generated report file to private storage under
 * `{restaurantId}/{folder}/…` and returns a time-limited signed URL that can be
 * shared without downloading the file first.
 */
export function useShareableReportLink() {
  const [isSharing, setIsSharing] = useState(false);
  const [link, setLink] = useState<ShareableLink | null>(null);

  const createLink = async (opts: {
    restaurantId: string;
    folder: string;
    fileName: string;
    blob: Blob;
    expiresInSeconds: number;
    contentType?: string;
  }): Promise<ShareableLink> => {
    setIsSharing(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${opts.restaurantId}/${opts.folder}/${stamp}_${opts.fileName}`;

      const { error: uploadError } = await db.storage
        .from(BUCKET)
        .upload(path, opts.blob, {
          contentType: opts.contentType ?? "application/pdf",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrl(path, opts.expiresInSeconds);
      if (error || !data?.signedUrl) throw error ?? new Error("Could not sign the link");

      const created: ShareableLink = {
        url: data.signedUrl,
        path,
        expiresInSeconds: opts.expiresInSeconds,
        expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
      };
      setLink(created);
      return created;
    } finally {
      setIsSharing(false);
    }
  };

  /** Re-signs an already uploaded file with a different validity window. */
  const resignLink = async (path: string, expiresInSeconds: number): Promise<ShareableLink> => {
    setIsSharing(true);
    try {
      const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrl(path, expiresInSeconds);
      if (error || !data?.signedUrl) throw error ?? new Error("Could not sign the link");
      const created: ShareableLink = {
        url: data.signedUrl,
        path,
        expiresInSeconds,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
      setLink(created);
      return created;
    } finally {
      setIsSharing(false);
    }
  };

  return { isSharing, link, setLink, createLink, resignLink };
}
