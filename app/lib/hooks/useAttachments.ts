import { useFetcher } from "@remix-run/react";
import { useState } from "react";

interface UseAttachmentsOptions {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface AttachmentResponse {
  success: boolean;
  error?: string;
}

export function useAttachments({ onSuccess, onError }: UseAttachmentsOptions = {}) {
  const fetcher = useFetcher<AttachmentResponse>();
  const [isUploading, setIsUploading] = useState(false);

  const uploadAttachment = async (routeId: number, file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('action', 'upload_route_attachment');
      formData.append('routeId', routeId.toString());
      formData.append('file', file);

      fetcher.submit(formData, { method: 'post' });
      
      if (fetcher.data?.success) {
        onSuccess?.();
      } else {
        onError?.(fetcher.data?.error || 'Failed to upload attachment');
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to upload attachment');
    } finally {
      setIsUploading(false);
    }
  };

  const deleteAttachment = async (routeId: number, attachmentId: number) => {
    try {
      const formData = new FormData();
      formData.append('action', 'delete_route_attachment');
      formData.append('routeId', routeId.toString());
      formData.append('attachmentId', attachmentId.toString());

      fetcher.submit(formData, { method: 'post' });
      
      if (fetcher.data?.success) {
        onSuccess?.();
      } else {
        onError?.(fetcher.data?.error || 'Failed to delete attachment');
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to delete attachment');
    }
  };

  return {
    uploadAttachment,
    deleteAttachment,
    isUploading
  };
} 