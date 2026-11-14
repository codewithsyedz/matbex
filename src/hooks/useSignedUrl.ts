import { useState, useEffect } from "react";
import { db } from "@/integrations/db/client";

/**
 * Hook to get a signed URL for private storage buckets.
 * Returns a signed URL that expires after the specified duration.
 * 
 * @param bucketName - The name of the storage bucket
 * @param filePath - The path to the file (can be a full URL or just the path)
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 */
export function useSignedUrl(
  bucketName: string,
  filePath: string | null,
  expiresIn: number = 3600
) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!filePath) {
      setSignedUrl(null);
      return;
    }

    const getSignedUrl = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Extract the file path from a full URL if necessary
        let path = filePath;
        const bucketPattern = new RegExp(`/${bucketName}/`);
        if (bucketPattern.test(filePath)) {
          const parts = filePath.split(`/${bucketName}/`);
          if (parts.length > 1) {
            path = parts[1];
          }
        }

        const { data, error: signError } = await db.storage
          .from(bucketName)
          .createSignedUrl(path, expiresIn);

        if (signError) throw signError;
        
        setSignedUrl(data.signedUrl);
      } catch (err) {
        console.error(`Error getting signed URL for ${bucketName}:`, err);
        setError(err instanceof Error ? err : new Error("Failed to get signed URL"));
        setSignedUrl(null);
      } finally {
        setIsLoading(false);
      }
    };

    getSignedUrl();
  }, [bucketName, filePath, expiresIn]);

  return { signedUrl, isLoading, error };
}

/**
 * Utility function to extract file path from a storage URL
 */
export function extractFilePath(url: string, bucketName: string): string {
  const bucketPattern = new RegExp(`/${bucketName}/`);
  if (bucketPattern.test(url)) {
    const parts = url.split(`/${bucketName}/`);
    if (parts.length > 1) {
      return parts[1];
    }
  }
  return url;
}

/**
 * Creates a signed URL for a file in a private bucket.
 * Use this for one-off URL generation (not in a component render cycle).
 */
export async function createSignedUrl(
  bucketName: string,
  filePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  try {
    // Extract the file path from a full URL if necessary
    const path = extractFilePath(filePath, bucketName);

    const { data, error } = await db.storage
      .from(bucketName)
      .createSignedUrl(path, expiresIn);

    if (error) throw error;
    
    return data.signedUrl;
  } catch (err) {
    console.error(`Error creating signed URL for ${bucketName}:`, err);
    return null;
  }
}
