import { ActionIcon, Group, Image, Modal, Paper, Stack, Text, useMantineTheme, FileButton, LoadingOverlay, Button } from "@mantine/core";
import { IconPaperclip, IconX, IconFileTypePdf, IconPhoto, IconRoute, IconDownload } from "@tabler/icons-react";
import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { notifications } from "@mantine/notifications";
import type { TopoAttachment } from "~/lib/models";
import Lightbox from "yet-another-react-lightbox-lite";
import type { LightboxProps } from "yet-another-react-lightbox-lite";
import "yet-another-react-lightbox-lite/styles.css";
import { GpxMapViewer } from "./GpxMapViewer";
import { useMapboxContext } from "~/contexts/MapboxContext";

interface TopoGalleryProps {
  attachments: TopoAttachment[];
  routeId?: number;
  sectorId?: number;
  cragId?: number;
  canEdit?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function TopoGallery({ 
  attachments, 
  routeId,
  sectorId,
  cragId,
  canEdit = false, 
  size = 'md'
}: TopoGalleryProps) {
  const theme = useMantineTheme();
  const { mapboxAccessToken, mapboxStyleUrl } = useMapboxContext();
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | undefined>(undefined);
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<number | null>(null);
  const [selectedGpxAttachment, setSelectedGpxAttachment] = useState<TopoAttachment | null>(null);
  const [isGpxModalOpen, setIsGpxModalOpen] = useState(false);
  const fetcher = useFetcher();

  const imageAttachments = attachments.filter(attachment => attachment.type.startsWith('image/'));

  const handleDeleteClick = (attachment: TopoAttachment) => {
    setDeleteAttachmentId(attachment.id);
  };

  const handleConfirmDelete = () => {
    if (!deleteAttachmentId) return;
    
    const formData = new FormData();
    formData.append('_action', 'delete');
    if (routeId) {
      formData.append('routeId', routeId.toString());
    } else if (sectorId) {
      formData.append('sectorId', sectorId.toString());
    } else if (cragId) {
      formData.append('cragId', cragId.toString());
    }
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
      if (routeId) {
        formData.append('routeId', routeId.toString());
      } else if (sectorId) {
        formData.append('sectorId', sectorId.toString());
      } else if (cragId) {
        formData.append('cragId', cragId.toString());
      }
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

  const handleDragStart = (e: React.DragEvent, attachment: TopoAttachment) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'attachment',
      id: attachment.id,
      attachmentType: attachment.type
    }));
  };

  const handleDragOverGallery = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnGallery = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));

      if (data.type === 'attachment' && data.id) {
        const attachmentId = data.id;

        const isSelfDrop = attachments.some(att => att.id === attachmentId);
        if (isSelfDrop) {
           console.log("Attempted to drop attachment onto its own gallery group.");
           return;
        }

        const formData = new FormData();
        formData.append('_action', 'add');
        formData.append('attachmentId', attachmentId.toString());

        if (routeId) {
          formData.append('routeId', routeId.toString());
        } else if (sectorId) {
          formData.append('sectorId', sectorId.toString());
        } else if (cragId) {
          formData.append('cragId', cragId.toString());
        } else {
          console.error("Drop target (gallery group) has no associated ID (cragId, sectorId, or routeId).");
          notifications.show({
            title: 'Error',
            message: 'Could not link attachment: Target ID missing.',
            color: 'red'
          });
          return;
        }

        console.log('Linking attachment (dropped on group):', attachmentId, 'to', { routeId, sectorId, cragId });
        fetcher.submit(formData, {
          method: 'post',
          action: '/api/attachments'
        });

      } else {
        console.warn('Dropped item (on group) is not a valid attachment.', data);
      }
    } catch (error) {
      console.error('Error handling drop on group:', error);
       notifications.show({
        title: 'Error',
        message: 'Failed to process dropped item.',
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
          <Text>Are you sure you want to remove this attachment from this object?</Text>
          <Text size="sm" c="red">This action cannot be undone.</Text>
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setDeleteAttachmentId(null)}>Cancel</Button>
            <Button color="red" onClick={handleConfirmDelete}>Delete</Button>
          </Group>
        </Stack>
      </Modal>

      {/* GPX Map Modal */}
      <Modal
        opened={isGpxModalOpen}
        onClose={() => setIsGpxModalOpen(false)}
        title={selectedGpxAttachment?.name || "GPX Track Viewer"}
        size="xl"
        overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      >
        <div style={{ position: 'relative' }}>
          {selectedGpxAttachment && (
            <ActionIcon
              variant="filled"
              color="blue"
              size="lg"
              radius="xl"
              pos="absolute"
              top={10}
              right={10}
              style={{ zIndex: 10 }}
              title={`Download ${selectedGpxAttachment.name || 'GPX file'}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!selectedGpxAttachment) return;
                const link = document.createElement('a');
                const url = selectedGpxAttachment.url.startsWith('http') ? selectedGpxAttachment.url : `https://${selectedGpxAttachment.url}`;
                link.href = url;
                const filename = selectedGpxAttachment.name || url.split('/').pop() || `track.gpx`;
                link.download = filename.endsWith('.gpx') ? filename : `${filename}.gpx`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              <IconDownload size={20} />
            </ActionIcon>
          )}
          {selectedGpxAttachment && mapboxAccessToken && mapboxStyleUrl ? (
            <GpxMapViewer 
              gpxUrl={selectedGpxAttachment.url} 
              accessToken={mapboxAccessToken} 
              styleUrl={mapboxStyleUrl} 
            />
          ) : (
            <Text c="dimmed">Map cannot be displayed. Configuration or attachment missing.</Text>
          )}
        </div>
      </Modal>

      <Group
        gap="xs"
        wrap="nowrap"
        pos="relative"
        onDrop={handleDropOnGallery}
        onDragOver={handleDragOverGallery}
        style={{ minHeight: getPreviewSize(), minWidth: getPreviewSize(), padding: '2px' }}
      >
        <LoadingOverlay visible={fetcher.state !== 'idle'} />
        
        {attachments.map((attachment, index) => {
          const attachmentUrl = attachment.url.startsWith('http') ? attachment.url : `https://${attachment.url}`;
          const type = attachment.type;

          return (
            <Paper
              key={attachment.id}
              component="a"
              href={attachmentUrl}
              target="_blank" 
              rel="noopener noreferrer"
              pos="relative"
              radius="sm"
              draggable
              onDragStart={(e: React.DragEvent) => handleDragStart(e, attachment)}
              style={{
                width: getPreviewSize(),
                height: getPreviewSize(),
                cursor: 'pointer',
                overflow: 'visible',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.gray[0],
                textDecoration: 'none',
              }}
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                if (type.startsWith('image/')) {
                  e.preventDefault();
                  const imageIndex = imageAttachments.findIndex(img => img.id === attachment.id);
                  setSelectedImageIndex(imageIndex);
                } else if (type === 'application/gpx+xml') {
                  e.preventDefault();
                  if (mapboxAccessToken && mapboxStyleUrl) {
                    setSelectedGpxAttachment(attachment);
                    setIsGpxModalOpen(true);
                  } else {
                    notifications.show({
                      title: 'Map Unavailable',
                      message: 'Map configuration is missing.',
                      color: 'orange'
                    });
                  }
                }
                // For PDF and all other types, do nothing here,
                // allow default <a> tag behavior (target="_blank" will open new tab)
              }}
            >
              {type.startsWith('image/') ? (
                <IconPhoto size={getIconSize()} color={theme.colors.blue[6]} />
              ) : type === 'application/gpx+xml' ? (
                <IconRoute size={getIconSize()} color={theme.colors.green[6]} />
              ) : type === 'application/pdf' ? (
                <IconFileTypePdf size={getIconSize()} color={theme.colors.red[6]} />
              ) : (
                <IconPaperclip size={getIconSize()} color={theme.colors.gray[6]} /> // Default icon
              )}
              
              {canEdit && (
                <ActionIcon
                  variant="subtle"
                  color="white"
                  size="xs"
                  pos="absolute"
                  top={-8}
                  right={-8}
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
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
          );
        })}

        {canEdit && (
          <FileButton
            onChange={handleFileSelect}
            accept="image/*,application/pdf,application/gpx+xml,.gpx"
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