import { Paper, Group, Title, Stack, ActionIcon, MantineTheme, TextInput, Modal, Text, Button, Overlay, Box } from "@mantine/core";
import { IconPencilPlus, IconArrowsUpDown, IconPencil, IconTrash, IconRobot, IconArrowFork, IconEdit, IconSquarePlus, IconCheck, IconX } from "@tabler/icons-react";
import { DroppableProvided, DraggableProvided, Droppable, Draggable } from "@hello-pangea/dnd";
import type { Sector as SectorType, Route } from "~/lib/models";
import { RouteCard } from "./RouteCard";
import { RouteEditCard } from "./RouteEditCard";
import { useState, useEffect } from "react";
import { TopoGallery } from "./TopoGallery";
import { Link, useFetcher } from "@remix-run/react";
import { CragPicker } from "./CragPicker";
import { RichTextViewer } from "./RichTextViewer";
import { ConfiguredRichTextEditor } from "./ConfiguredRichTextEditor";

interface ActionResponse {
  success: boolean;
  error?: string;
}

interface SectorCardProps {
  sector: SectorType;
  theme: MantineTheme;
  canEdit: boolean;
  editingRouteId: string | null;
  reorderingSectorId: number | null;
  newRouteSectorId: number | null;
  sortingSectors: boolean;
  onNewRoute: (sectorId: number) => void;
  onReorderingChange: (sectorId: number | null) => void;
  onEditClick: (routeId: number) => void;
  onCancelEdit: () => void;
  onCancelNewRoute: () => void;
  onDeleteClick: (routeId: number, routeName: string) => void;
  onSectorNameChange?: (sectorId: number, newName: string) => void;
  onDeleteSector?: (sectorId: number, sectorName: string) => void;
  id?: string;
}

export function SectorCard({
  sector,
  theme,
  canEdit,
  editingRouteId,
  reorderingSectorId,
  newRouteSectorId,
  sortingSectors,
  onNewRoute,
  onReorderingChange,
  onEditClick,
  onCancelEdit,
  onCancelNewRoute,
  onDeleteClick,
  onSectorNameChange,
  onDeleteSector,
  id,
}: SectorCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [sectorName, setSectorName] = useState(sector.name);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const moveFetcher = useFetcher();
  const [isEditingSectorNotes, setIsEditingSectorNotes] = useState(false);
  const sectorNotesFetcher = useFetcher<ActionResponse>();

  useEffect(() => {
    if (sectorNotesFetcher.state === 'idle' && sectorNotesFetcher.data?.success) {
      setIsEditingSectorNotes(false);
    }
  }, [sectorNotesFetcher.state, sectorNotesFetcher.data]);

  const handleNameSubmit = () => {
    if (onSectorNameChange && sectorName !== sector.name) {
      onSectorNameChange(sector.id, sectorName);
    }
    setIsEditingName(false);
  };

  const handleMoveSector = (targetCragId: string) => {
    const formData = new FormData();
    formData.append('action', 'move_sector');
    formData.append('sectorId', sector.id.toString());
    formData.append('targetCragId', targetCragId);

    moveFetcher.submit(formData, { method: 'post' });
    setIsMoveModalOpen(false);
  };

  return (
    <>
      <Modal
        opened={isMoveModalOpen}
        onClose={() => setIsMoveModalOpen(false)}
        title={`Move "${sector.name}" to Another Crag`}
        size="sm"
      >
        <CragPicker
          currentCragId={sector.cragId!}
          onSelect={handleMoveSector}
          onCancel={() => setIsMoveModalOpen(false)}
        />
      </Modal>

      {reorderingSectorId !== null && reorderingSectorId !== sector.id && (
        <Overlay
          fixed
          opacity={0.08}
          zIndex={100}
          color={theme.colors.dark[7]}
        />
      )}
      <Paper
        shadow="sm"
        p="md"
        radius="md"
        withBorder
        style={{
          backgroundColor: theme.colors.gray[1],
          position: 'relative',
          zIndex: reorderingSectorId === sector.id ? 101 : 1,
          borderStyle: sortingSectors ? 'dashed' : 'solid',
          borderColor: sortingSectors ? theme.colors.dark[4] : undefined,
          borderWidth: sortingSectors ? '2px' : undefined,
          cursor: sortingSectors ? 'row-resize' : 'default'
        }}
        id={id}
      >
        <Group justify="space-between" mb="sm">
          {canEdit && isEditingName ? (
            <TextInput
              value={sectorName}
              onChange={(event) => setSectorName(event.currentTarget.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleNameSubmit();
                } else if (e.key === 'Escape') {
                  setSectorName(sector.name);
                  setIsEditingName(false);
                }
              }}
              size="xs"
              styles={{
                input: {
                  fontSize: 'var(--mantine-font-size-h4)',
                  fontWeight: 'bold'
                }
              }}
              autoFocus
              disabled={sortingSectors}
            />
          ) : (
            <Group gap="xs">
              <Title 
                order={2} 
                size="h4" 
                style={{ 
                  cursor: canEdit && !sortingSectors ? 'pointer' : 'default' 
                }} 
                onClick={() => canEdit && !sortingSectors && setIsEditingName(true)}
              >
                {sector.name}
              </Title>
              <TopoGallery
                attachments={sector.attachments ?? []}
                sectorId={sector.id}
                canEdit={canEdit}
                size="xs"
              />
            </Group>
          )}
          {canEdit && (         
            <Group gap="xs">
              <ActionIcon
                variant={newRouteSectorId === sector.id ? "filled" : "subtle"}
                color={newRouteSectorId === sector.id ? "blue" : "gray"}
                title="Add Route"
                disabled={reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null || sortingSectors}
                onClick={() => onNewRoute(sector.id)}
              >
                <IconPencilPlus size={16} />
              </ActionIcon>
              <ActionIcon
                variant={reorderingSectorId === sector.id ? "filled" : "subtle"}
                color={reorderingSectorId === sector.id ? "blue" : "gray"}
                onClick={() => onReorderingChange(reorderingSectorId === sector.id ? null : sector.id)}
                title={reorderingSectorId === sector.id ? "Save Order" : "Reorder Routes"}
                disabled={editingRouteId !== null || newRouteSectorId !== null || sortingSectors}
              >
                <IconArrowsUpDown size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                title="Move to Another Crag"
                disabled={reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null || sortingSectors}
                onClick={() => setIsMoveModalOpen(true)}
              >
                <IconArrowFork size={16} />
              </ActionIcon>
              <ActionIcon
                component={Link}
                to={`/topos/importer?sectorId=${sector.id}`}
                variant="subtle"
                color="gray"
                title="Import Data"
                disabled={reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null || sortingSectors}
              >
                <IconRobot size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                title={sector.routes?.length ? "Sector must be empty" : "Delete Sector"}
                disabled={reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null || sector.routes?.length > 0 || sortingSectors}
                onClick={() => onDeleteSector?.(sector.id, sector.name)}
              >
                <IconTrash size={16} />
              </ActionIcon>
              <Text size="xs" c="dimmed" title="Sector Order">
                #{sector.sortOrder ?? '-'}
              </Text>
            </Group>
          )}
        </Group>

        <Box mb="md">
          {isEditingSectorNotes ? (
            <sectorNotesFetcher.Form method="post">
              <input type="hidden" name="action" value="update_sector_notes" />
              <input type="hidden" name="sectorId" value={sector.id.toString()} />
              <ConfiguredRichTextEditor
                name="notes"
                initialContent={sector.notes ?? ''}
                mt="xs"
              />
              <Group justify="flex-end" mt="xs" gap="xs">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setIsEditingSectorNotes(false)}
                  title="Cancel"
                >
                  <IconX size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="green"
                  type="submit"
                  title="Save Notes"
                  loading={sectorNotesFetcher.state !== 'idle'}
                >
                  <IconCheck size={16} />
                </ActionIcon>
              </Group>
            </sectorNotesFetcher.Form>
          ) : (
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              {sector.notes ? (
                <Box 
                  style={{ 
                    flexGrow: 1, 
                    cursor: canEdit && !sortingSectors ? 'pointer' : 'default',
                    fontSize: 'var(--mantine-font-size-sm)',
                    '& h3': {
                       fontSize: theme.headings.sizes.h3.fontSize, 
                       marginTop: theme.spacing.sm,
                       marginBottom: theme.spacing.xs,
                    }
                  }} 
                  onClick={canEdit && !sortingSectors ? () => setIsEditingSectorNotes(true) : undefined}
                >
                  <RichTextViewer content={sector.notes} />
                </Box>
              ) : (
                canEdit && !sortingSectors && (
                  <Button 
                    leftSection={<IconSquarePlus size={16} />} 
                    variant="subtle" 
                    color="gray" 
                    onClick={() => setIsEditingSectorNotes(true)}
                    disabled={sortingSectors || reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null}
                  >
                      Add Notes
                  </Button>
                )
              )}
            </Group>
          )}
        </Box>

        <Droppable 
          droppableId={sector.id.toString()} 
          type="route" 
          isDropDisabled={reorderingSectorId === null}
        >
          {(provided: DroppableProvided) => (
            <Stack gap="xs" ref={provided.innerRef} {...provided.droppableProps}>
              {!sortingSectors && (
                <>
                  {newRouteSectorId === sector.id && (
                    <RouteEditCard
                      route={{
                        id: -1,
                        name: "",
                        sectorId: sector.id,
                        issues: []
                      }}
                      theme={theme}
                      onCancel={onCancelNewRoute}
                      isNew={true}
                    />
                  )}
                  {sector.routes?.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((route, index) => {
                    const routeId = typeof route.id === 'string' ? parseInt(route.id, 10) : route.id;
                    return (
                      <Draggable
                        key={routeId}
                        draggableId={routeId.toString()}
                        index={index}
                        isDragDisabled={reorderingSectorId !== sector.id}
                      >
                        {(provided: DraggableProvided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              ...provided.draggableProps.style,
                              opacity: snapshot.isDragging ? 0.8 : 1,
                              transform: snapshot.isDragging
                                ? `${provided.draggableProps.style?.transform} scale(1.02)`
                                : provided.draggableProps.style?.transform,
                              cursor: reorderingSectorId === sector.id ? 'row-resize' : 'default'
                            }}
                          >
                            <Group gap="xs">
                              {canEdit && (
                                <Stack gap={5} miw={30}>
                                  <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    title="Edit Route"
                                    disabled={editingRouteId === routeId.toString() || reorderingSectorId !== null || sortingSectors}
                                    onClick={() => {
                                      if (editingRouteId !== null) {
                                        onCancelEdit();
                                      }
                                      onEditClick(routeId);
                                    }}
                                  >
                                    <IconPencil size={16} />
                                  </ActionIcon>
                                  <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    title="Delete Route"
                                    disabled={editingRouteId === routeId.toString() || reorderingSectorId !== null || sortingSectors}
                                    onClick={() => onDeleteClick(routeId, route.name)}
                                  >
                                    <IconTrash size={16} />
                                  </ActionIcon>
                                </Stack>
                              )}
                              {editingRouteId === routeId.toString() ? (
                                <RouteEditCard
                                  route={route}
                                  theme={theme}
                                  onCancel={onCancelEdit}
                                />
                              ) : (
                                <RouteCard 
                                  route={route} 
                                  theme={theme} 
                                  canEdit={canEdit}
                                />
                              )}
                            </Group>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                </>
              )}
              {provided.placeholder}
            </Stack>
          )}
        </Droppable>
      </Paper>
    </>
  );
} 