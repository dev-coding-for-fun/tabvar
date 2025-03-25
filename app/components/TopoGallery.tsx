import { ActionIcon, Group, Image, Modal, Paper, Stack, Text, useMantineTheme, FileButton, LoadingOverlay } from "@mantine/core";
import { IconPaperclip, IconTrash, IconFileTypePdf } from "@tabler/icons-react";
import { useState } from "react";
import { useAttachments } from "~/lib/hooks/useAttachments";
import { notifications } from "@mantine/notifications";
import type { TopoAttachment as TopoAttachment } from "~/lib/models";

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
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const { uploadAttachment, deleteAttachment, isUploading } = useAttachments({
    onSuccess: () => {
      notifications.show({
        title: 'Success',
        message: 'Attachment operation completed successfully',
        color: 'green'
      });
    },
    onError: (error) => {
      notifications.show({
        title: 'Error',
        message: error,
        color: 'red'
      });
    }
  });

  const handleAttachmentClick = (attachment: TopoAttachment) => {
    if (attachment.type.startsWith('image/')) {
      setSelectedImage(attachment.url);
    } else if (attachment.type === 'application/pdf') {
      window.open(attachment.url, '_blank');
    }
  };

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;
    await uploadAttachment(routeId, file);
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    await deleteAttachment(routeId, attachmentId);
  };

  const getIconSize = () => {
    switch (size) {
      case 'xs': return 16;
      case 'sm': return 20;
      case 'md': return 24;
      case 'lg': return 28;
      case 'xl': return 32;
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
      <Modal
        opened={!!selectedImage}
        onClose={() => setSelectedImage(null)}
        size="xl"
        padding={0}
      >
        {selectedImage && (
          <Image
            src={selectedImage}
            alt="Topo preview"
            fit="contain"
            style={{ maxHeight: '80vh' }}
          />
        )}
      </Modal>

      <Group gap="xs" wrap="nowrap" pos="relative">
        <LoadingOverlay visible={isUploading} />
        
        {attachments.map((attachment) => (
          <Paper
            key={attachment.id}
            pos="relative"
            radius="sm"
            style={{
              width: getPreviewSize(),
              height: getPreviewSize(),
              cursor: 'pointer',
              overflow: 'hidden'
            }}
            onClick={() => handleAttachmentClick(attachment)}
          >
            {attachment.type.startsWith('image/') ? (
              <Image
                src={attachment.url}
                alt={attachment.name || 'Topo image'}
                fit="cover"
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <Group
                h="100%"
                w="100%"
                justify="center"
                bg={theme.colors.gray[0]}
              >
                <IconFileTypePdf size={getIconSize()} color={theme.colors.red[6]} />
              </Group>
            )}
            
            {canEdit && (
              <ActionIcon
                variant="filled"
                color="red"
                size="xs"
                pos="absolute"
                top={4}
                right={4}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteAttachment(attachment.id);
                }}
              >
                <IconTrash size={12} />
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