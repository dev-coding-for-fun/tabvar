import { ActionIcon, Group, Image, Modal, Paper, Stack, Text, useMantineTheme, FileButton, LoadingOverlay, Button } from "@mantine/core";
import { IconPaperclip, IconX, IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { notifications } from "@mantine/notifications";
import type { TopoAttachment } from "~/lib/models";
import Lightbox from "yet-another-react-lightbox-lite";
import type { LightboxProps } from "yet-another-react-lightbox-lite";
import "yet-another-react-lightbox-lite/styles.css";

interface TopoGalleryProps {
  attachments: TopoAttachment[];
  routeId: number;
  canEdit?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function TopoGallery({ 
  attachments, 
  routeId,
  canEdit = false, 
  size = 'md'
}: TopoGalleryProps) {
  const theme = useMantineTheme();
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | undefined>(undefined);
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<number | null>(null);
  const fetcher = useFetcher();

  const imageAttachments = attachments.filter(attachment => attachment.type.startsWith('image/'));

  const handleAttachmentClick = (attachment: TopoAttachment, index: number) => {
    if (attachment.type.startsWith('image/')) {
      const imageIndex = imageAttachments.findIndex(img => img.id === attachment.id);
      setSelectedImageIndex(imageIndex);
    } else if (attachment.type === 'application/pdf') {
      const url = attachment.url.startsWith('http') ? attachment.url : `https://${attachment.url}`;
      window.open(url, '_blank');
    }
  };

  const handleDeleteClick = (attachment: TopoAttachment) => {
    setDeleteAttachmentId(attachment.id);
  };

  const handleConfirmDelete = () => {
    if (!deleteAttachmentId) return;
    
    const formData = new FormData();
    formData.append('_action', 'delete');
    formData.append('routeId', routeId.toString());
    formData.append('attachmentId', deleteAttachmentId.toString());

    fetcher.submit(formData, { 
      method: 'post',
      action: '/api/attachments'
    });

    setDeleteAttachmentId(null);
  };

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('_action', 'upload');
      formData.append('routeId', routeId.toString());
      formData.append('file', file);

      fetcher.submit(formData, { 
        method: 'post',
        action: '/api/attachments',
        encType: 'multipart/form-data'
      });
    } catch (error) {
      console.error('Error preparing file:', error);
      notifications.show({
        title: 'Error',
        message: 'Failed to prepare file for upload',
        color: 'red'
      });
    }
  };

  const getIconSize = () => {
    switch (size) {
      case 'xs': return 20;
      case 'sm': return 24;
      case 'md': return 28;
      case 'lg': return 32;
      case 'xl': return 40;
    }
  };

  const getPreviewSize = () => {
    switch (size) {
      case 'xs': return 34;
      case 'sm': return 48;
      case 'md': return 64;
      case 'lg': return 80;
      case 'xl': return 96;
    }
  };

  return (
    <>
      <Lightbox
        index={selectedImageIndex}
        setIndex={setSelectedImageIndex}
        slides={imageAttachments.map(attachment => ({
          src: attachment.url,
          alt: attachment.name || 'Topo image'
        }))}
      />

      <Modal
        opened={deleteAttachmentId !== null}
        onClose={() => setDeleteAttachmentId(null)}
        title="Delete Attachment"
        size="sm"
      >
        <Stack>
          <Text>Are you sure you want to delete this attachment?</Text>
          <Text size="sm" c="red">This action cannot be undone.</Text>
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setDeleteAttachmentId(null)}>Cancel</Button>
            <Button color="red" onClick={handleConfirmDelete}>Delete</Button>
          </Group>
        </Stack>
      </Modal>

      <Group gap="xs" wrap="nowrap" pos="relative">
        <LoadingOverlay visible={fetcher.state !== 'idle'} />
        
        {attachments.map((attachment, index) => (
          <Paper
            key={attachment.id}
            pos="relative"
            radius="sm"
            style={{
              width: getPreviewSize(),
              height: getPreviewSize(),
              cursor: 'pointer',
              overflow: 'visible',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.gray[0]
            }}
            onClick={() => handleAttachmentClick(attachment, index)}
          >
            {attachment.type === 'application/pdf' ? (
              <IconFileTypePdf size={getIconSize()} color={theme.colors.red[6]} />
            ) : (
              <IconPhoto size={getIconSize()} color={theme.colors.blue[6]} />
            )}
            
            {canEdit && (
              <ActionIcon
                variant="subtle"
                color="white"
                size="xs"
                pos="absolute"
                top={-8}
                right={-8}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick(attachment);
                }}
                style={{
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255, 0, 0, 0.9)',
                }}
              >
                <IconX size={12} />
              </ActionIcon>
            )}
          </Paper>
        ))}

        {canEdit && (
          <FileButton
            onChange={handleFileSelect}
            accept="image/*,application/pdf"
          >
            {(props) => (
              <Paper
                {...props}
                radius="sm"
                style={{
                  width: getPreviewSize(),
                  height: getPreviewSize(),
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px dashed ${theme.colors.gray[4]}`,
                  backgroundColor: theme.colors.gray[0]
                }}
              >
                <IconPaperclip size={getIconSize()} color={theme.colors.gray[6]} />
              </Paper>
            )}
          </FileButton>
        )}
      </Group>
    </>
  );
} 