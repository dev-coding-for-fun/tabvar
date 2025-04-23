import { Container, Group, Stack, Text, Title, useMantineTheme, rem, Button, Box, Badge, ActionIcon, Modal, TextInput } from "@mantine/core";
import { type LoaderFunction, type ActionFunction, data, redirect } from "@remix-run/cloudflare";
import { useLoaderData, Link, useSearchParams, useNavigate, useFetcher, useLocation } from "@remix-run/react";
import { IconArrowBack, IconArrowsUpDown, IconTrash, IconTextPlus, IconRobot } from "@tabler/icons-react";
import { getDB } from "~/lib/db";
import { useEffect, useState } from "react";
import type { Crag, Sector, Route } from "~/lib/models";
import { loadCragByName, loadCragById, deleteCrag } from "~/lib/crag.server";
import { getAuthenticator } from "~/lib/auth.server";
import type { User } from "~/lib/models";
import { DragDropContext, Droppable, Draggable, DropResult, DroppableProvided, DraggableProvided } from '@hello-pangea/dnd';
import { SectorCard } from "~/components/SectorCard";
import { createSector, updateSectorName, deleteSector } from "~/lib/sector.server";
import { createRoute, updateRoute, updateRouteOrder, deleteRoute } from "~/lib/route.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { TopoGallery } from "~/components/TopoGallery";

export const loader: LoaderFunction = async ({ params, context, request }) => {
  const cragId = parseInt(params.crag ?? "");
  const user = await getAuthenticator(context).isAuthenticated(request);

  if (!cragId) {
    throw new Response("Crag identifier is required", { status: 400 });
  }

  try {
    let crag: Crag;
    crag = await loadCragById(context, cragId);
    
    //bring any untitled sectors to the top
    const untitledSectors = crag.sectors?.filter(sector => sector.name?.startsWith("Untitled Sector"))
      .sort((a, b) => a.name > b.name ? 1 : -1);   
    const otherSectors = crag.sectors?.filter(sector => sector.name !== "Untitled Sector");
    const sortedSectors = [...(untitledSectors || []), ...(otherSectors || [])];
    
    return { crag: { ...crag, sectors: sortedSectors }, user };
  } catch (error) {
    throw new Response("Crag not found", { status: 404 });
  }
};

export const action: ActionFunction = async ({ request, context }) => {
  const user = await getAuthenticator(context).isAuthenticated(request, {
    failureRedirect: "/login",
  });
  if (user.role !== 'admin' && user.role !== 'member') {
    return { error: PERMISSION_ERROR };
  }

  const formData = await request.formData();
  const action = formData.get("action");

  switch (action) {
    case "create_sector": {
      const cragId = formData.get("cragId")?.toString();
      const name = formData.get("name")?.toString() ?? "Untitled Sector";

      if (!cragId) {
        return { success: false, error: "Sector must be associated with a crag" };
      }

      return await createSector(context, parseInt(cragId), name);
    }

    case "update_sector_name": {
      const sectorId = formData.get("sectorId")?.toString();
      const name = formData.get("name")?.toString();

      if (!sectorId || !name) {
        return { success: false, error: "Missing required fields" };
      }

      return await updateSectorName(context, parseInt(sectorId), name);
    }

    case "move_sector": {
      const sectorId = formData.get("sectorId")?.toString();
      const targetCragId = formData.get("targetCragId")?.toString();

      if (!sectorId || !targetCragId) {
        return { success: false, error: "Missing required fields" };
      }

      const db = getDB(context);
      await db.updateTable('sector')
        .set({ crag_id: parseInt(targetCragId) })
        .where('id', '=', parseInt(sectorId))
        .execute();

      return { success: true };
    }

    case "update_crag_name": {
      const cragId = formData.get("cragId")?.toString();
      const name = formData.get("name")?.toString();

      if (!cragId || !name) {
        return { success: false, error: "Missing required fields" };
      }

      const db = getDB(context);
      await db.updateTable('crag')
        .set({ name })
        .where('id', '=', parseInt(cragId))
        .execute();

      return { success: true };
    }

    case "delete_sector": {
      const sectorId = Number(formData.get("sectorId")) ?? null;
      return await deleteSector(context, sectorId);
    }

    case "create_route": {
      const sectorId = Number(formData.get("sectorId")) ?? null;
      const name = formData.get("name")?.toString();
      const gradeYds = formData.get("gradeYds")?.toString();
      const climbStyle = formData.get("climbStyle")?.toString();
      const boltCount = Number(formData.get("boltCount")) ?? null;
      const routeLength = Number(formData.get("routeLength")) ?? null;
      const firstAscentBy = formData.get("firstAscentBy")?.toString() || null;
      const pitchCount = Number(formData.get("pitchCount")) ?? null;
      const year = Number(formData.get("year")) ?? null;

      const newRoute: Partial<Route> = {
        sectorId,
        name,
        gradeYds,
        climbStyle,
        boltCount,
        routeLength,
        firstAscentBy,
        pitchCount,
        year
      };

      return await createRoute(context, newRoute);
    }

    case "update_route": {
      const routeId = Number(formData.get("routeId")) ?? null;
      const name = formData.get("name")?.toString();
      const gradeYds = formData.get("gradeYds")?.toString();
      const climbStyle = formData.get("climbStyle")?.toString();
      const boltCount = formData.get("boltCount") ? Number(formData.get("boltCount")) : null;
      const routeLength = formData.get("routeLength") ? Number(formData.get("routeLength")) : null;
      const firstAscentBy = formData.get("firstAscentBy")?.toString() || null;
      const pitchCount = formData.get("pitchCount") ? Number(formData.get("pitchCount")) : null;
      const year = formData.get("year") ? Number(formData.get("year")) : null;
      const notes = formData.get("notes")?.toString() || null;

      const updatedRoute: Partial<Route> = {
        id:routeId,
        name,
        gradeYds,
        climbStyle,
        boltCount,
        routeLength,
        firstAscentBy,
        pitchCount,
        year,
        notes
      };

      return await updateRoute(context, updatedRoute);
    }

    case "move_route": {
      const routeId = Number(formData.get("routeId")) ?? null;
      const destinationSectorId = Number(formData.get("destinationSectorId")) ?? null;

      if (!routeId || !destinationSectorId) {
        return { success: false, error: "Missing required fields for route move" };
      }

      const db = getDB(context);
      try {
        await db.updateTable('route')
          .set({ sector_id: destinationSectorId })
          .where('id', '=', routeId)
          .executeTakeFirstOrThrow(); // Use executeTakeFirstOrThrow for better error handling if route doesn't exist
        return { success: true };
      } catch (error: any) {
        console.error("Error moving route:", error);
        return { success: false, error: error.message || "Failed to move route" };
      }
    }

    case "update_route_order": {
      const sectorId = Number(formData.get("sectorId")) ?? null;
      const routesData = JSON.parse(formData.get("routes")?.toString() ?? "[]");

      return await updateRouteOrder(context, sectorId, routesData);
    }

    case "delete_route": {
      const routeId = Number(formData.get("routeId")) ?? null;

      return await deleteRoute(context, routeId);
    }

    case "update_sector_order": {
      const sectorsData = JSON.parse(formData.get("sectors")?.toString() ?? "[]");
      const db = getDB(context);
      
      // Update each sector's sort order
      for (const sector of sectorsData) {
        await db.updateTable('sector')
          .set({ sort_order: sector.sortOrder })
          .where('id', '=', sector.id)
          .execute();
      }
      
      return { success: true };
    }

    case "delete_crag": {
      const cragId = Number(formData.get("cragId")) ?? null;

      const result = await deleteCrag(context, cragId);
      if (!result.success) {
        return new Response(result.error, { status: 400 });
      }
      return redirect("/topos");
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
};

export default function CragPage() {
  const { crag: initialCrag, user } = useLoaderData<{ crag: Crag; user: User | null }>();
  const [crag, setCrag] = useState(initialCrag);
  const theme = useMantineTheme();
  const canEdit = user && (user.role === 'admin' || user.role === 'member');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const editingRouteId = searchParams.get('editroute');
  const [reorderingSectorId, setReorderingSectorId] = useState<number | null>(null);
  const [newRouteSectorId, setNewRouteSectorId] = useState<number | null>(null);
  const [deleteRouteId, setDeleteRouteId] = useState<number | null>(null);
  const [deleteRouteName, setDeleteRouteName] = useState<string>("");
  const [sortingSectors, setSortingSectors] = useState(false);
  const [deleteCragModalOpen, setDeleteCragModalOpen] = useState(false);
  const [isEditingCragName, setIsEditingCragName] = useState(false);
  const [cragName, setCragName] = useState(crag.name);
  const deleteFetcher = useFetcher();
  const sectorNameFetcher = useFetcher();
  const sectorCreateFetcher = useFetcher();
  const sectorDeleteFetcher = useFetcher();
  const deleteCragFetcher = useFetcher();
  const cragNameFetcher = useFetcher();

  // Handle anchor navigation
  useEffect(() => {
    if (location.hash) {
      const element = document.getElementById(location.hash.substring(1));
      if (element) {
        // Add a small delay to ensure the page has rendered
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    }
  }, [location.hash, crag]);

  // Update local state when server data changes
  useEffect(() => {
    setCrag(initialCrag);
    setCragName(initialCrag.name);
  }, [initialCrag]);

  const handleEditClick = (routeId: number) => {
    setSearchParams(
      { editroute: routeId.toString() },
      { preventScrollReset: true, replace: true }
    );
  };

  const handleCancelEdit = () => {
    searchParams.delete('editroute');
    setSearchParams(
      searchParams,
      { preventScrollReset: true, replace: true }
    );
  };

  const handleNewRoute = (sectorId: number) => {
    setNewRouteSectorId(sectorId);
  };

  const handleCancelNewRoute = () => {
    setNewRouteSectorId(null);
  };

  const handleSectorReorder = async (sectors: Sector[], sourceIndex: number, destinationIndex: number) => {
    const [reorderedSector] = sectors.splice(sourceIndex, 1);
    sectors.splice(destinationIndex, 0, reorderedSector);

    // Update the sectors array immediately for UI
    setCrag(prevCrag => ({
      ...prevCrag,
      sectors: sectors.map((sector, index) => ({ ...sector, sortOrder: index + 1 }))
    }));

    // Save the new order
    const formData = new FormData();
    formData.append('action', 'update_sector_order');
    formData.append('sectors', JSON.stringify(sectors.map((sector, index) => ({
      id: sector.id,
      sortOrder: index + 1
    }))));

    await fetch(window.location.pathname, {
      method: 'POST',
      body: formData
    });
  };

  const handleRouteReorder = async (sectorId: number, routes: Route[], sourceIndex: number, destinationIndex: number) => {
    const [reorderedRoute] = routes.splice(sourceIndex, 1);
    routes.splice(destinationIndex, 0, reorderedRoute);

    // Update the routes array in the sector immediately for UI
    const updatedSectors = crag.sectors.map(s => {
      if (s.id === sectorId) {
        return { ...s, routes: routes.map((route, index) => ({ ...route, sortOrder: index + 1 })) };
      }
      return s;
    });

    // Update state with the new order
    setCrag(prevCrag => ({
      ...prevCrag,
      sectors: updatedSectors
    }));

    // Save the new order
    const formData = new FormData();
    formData.append('action', 'update_route_order');
    formData.append('sectorId', sectorId.toString());
    formData.append('routes', JSON.stringify(routes.map((route, index) => ({
      id: route.id,
      sortOrder: index + 1
    }))));

    fetch(window.location.pathname, {
      method: 'POST',
      body: formData
    });
  };

  const handleRouteMove = async (
    sourceSectorId: number,
    destinationSectorId: number,
    sourceIndex: number,
    destinationIndex: number,
    routeId: number
  ) => {
    let movedRoute: Route | undefined;
    let sourceRoutes: Route[] = [];
    let destinationRoutes: Route[] = [];

    // Optimistically update the UI
    const updatedSectors = crag.sectors.map(s => {
      if (s.id === sourceSectorId) {
        sourceRoutes = [...(s.routes || [])];
        [movedRoute] = sourceRoutes.splice(sourceIndex, 1);
        return { ...s, routes: sourceRoutes.map((route, index) => ({ ...route, sortOrder: index + 1 })) };
      }
      if (s.id === destinationSectorId) {
        destinationRoutes = [...(s.routes || [])];
      }
      return s; // Return other sectors unchanged for now
    });

    if (!movedRoute) {
      console.error("Moved route not found!");
      return; 
    }

    // Add the moved route to the destination sector's routes
    destinationRoutes.splice(destinationIndex, 0, { ...movedRoute, sectorId: destinationSectorId });

    // Final state update
    setCrag(prevCrag => ({
      ...prevCrag,
      sectors: prevCrag.sectors.map(s => {
        if (s.id === sourceSectorId) {
          return { ...s, routes: sourceRoutes.map((route, index) => ({ ...route, sortOrder: index + 1 })) };
        }
        if (s.id === destinationSectorId) {
          return { ...s, routes: destinationRoutes.map((route, index) => ({ ...route, sortOrder: index + 1 })) };
        }
        return s;
      })
    }));

    // --- Backend Updates ---

    // 1. Update the route's sectorId using the new move_route action
    const moveRouteFormData = new FormData();
    moveRouteFormData.append('action', 'move_route');
    moveRouteFormData.append('routeId', routeId.toString());
    moveRouteFormData.append('destinationSectorId', destinationSectorId.toString());

    // Consider using a fetcher for this
    await fetch(window.location.pathname, {
      method: 'POST',
      body: moveRouteFormData
    });

    // 2. Update sort order in the source sector
    const sourceOrderFormData = new FormData();
    sourceOrderFormData.append('action', 'update_route_order');
    sourceOrderFormData.append('sectorId', sourceSectorId.toString());
    sourceOrderFormData.append('routes', JSON.stringify(sourceRoutes.map((route, index) => ({
      id: route.id,
      sortOrder: index + 1
    }))));
    // Consider using a fetcher for this
    await fetch(window.location.pathname, {
      method: 'POST',
      body: sourceOrderFormData
    });

    // 3. Update sort order in the destination sector
    const destOrderFormData = new FormData();
    destOrderFormData.append('action', 'update_route_order');
    destOrderFormData.append('sectorId', destinationSectorId.toString());
    destOrderFormData.append('routes', JSON.stringify(destinationRoutes.map((route, index) => ({
      id: route.id,
      sortOrder: index + 1
    }))));
    // Consider using a fetcher for this
    await fetch(window.location.pathname, {
      method: 'POST',
      body: destOrderFormData
    });
  };

  const handleReorderDragEnd = async (result: DropResult) => {
    const { source, destination, type } = result;

    // Dropped outside the list or no destination
    if (!destination) {
      return;
    }

    // Handle sector reordering
    if (type === 'sector') {
      if (source.index === destination.index) return; // No change
      await handleSectorReorder(
        [...crag.sectors],
        source.index,
        destination.index
      );
      return;
    }

    // Handle route movement (reorder within sector or move between sectors)
    if (type === 'route') {
      const sourceSectorId = parseInt(source.droppableId);
      const destinationSectorId = parseInt(destination.droppableId);
      const routeId = parseInt(result.draggableId);

      // Reordering within the same sector
      if (sourceSectorId === destinationSectorId) {
        if (source.index === destination.index) return; // No change

        const sector = crag.sectors?.find(s => s.id === sourceSectorId);
        if (!sector || !sector.routes) return;

        await handleRouteReorder(
          sourceSectorId,
          [...sector.routes],
          source.index,
          destination.index
        );
      }
      // Moving route to a different sector
      else {
        await handleRouteMove(
          sourceSectorId,
          destinationSectorId,
          source.index,
          destination.index,
          routeId
        );
      }
    }
  };

  const handleDeleteClick = (routeId: number, routeName: string) => {
    setDeleteRouteId(routeId);
    setDeleteRouteName(routeName);
  };

  const handleConfirmDelete = async () => {
    if (!deleteRouteId) return;

    // Find the sector that contains this route
    const sectorWithRoute = crag.sectors?.find(sector => 
      sector.routes?.some(route => route.id === deleteRouteId)
    );

    if (sectorWithRoute) {
      // Optimistically update the UI by filtering out the deleted route
      sectorWithRoute.routes = sectorWithRoute.routes?.filter(route => route.id !== deleteRouteId);
    }

    deleteFetcher.submit(
      { action: 'delete_route', routeId: deleteRouteId.toString() },
      { method: 'post' }
    );

    setDeleteRouteId(null);
  };

  const handleSectorNameChange = async (sectorId: number, newName: string) => {
    // Optimistically update the UI
    setCrag(prevCrag => ({
      ...prevCrag,
      sectors: prevCrag.sectors.map(sector => 
        sector.id === sectorId ? { ...sector, name: newName } : sector
      )
    }));

    // Send update to server
    const formData = new FormData();
    formData.append('action', 'update_sector_name');
    formData.append('sectorId', sectorId.toString());
    formData.append('name', newName);
    sectorNameFetcher.submit(formData, { method: 'post' });
  };

  const handleAddSector = async () => {
    // Optimistically update the UI
    const optimisticSector: Sector = {
      id: Date.now(), // Temporary ID
      name: 'Untitled Sector',
      cragId: crag.id,
      routes: [],
      latitude: null,
      longitude: null,
      sortOrder: -1,
      createdAt: new Date().toISOString()
    };

    setCrag(prevCrag => ({
      ...prevCrag,
      sectors: [optimisticSector, ...(prevCrag.sectors || [])]
    }));

    // Send create request to server
    const formData = new FormData();
    formData.append('action', 'create_sector');
    formData.append('cragId', crag.id.toString());
    formData.append('name', 'Untitled Sector');

    sectorCreateFetcher.submit(formData, { method: 'post' });
  };

  const handleDeleteSector = (sectorId: number, sectorName: string) => {
    // Optimistically update the UI by filtering out the deleted sector
    setCrag(prevCrag => ({
      ...prevCrag,
      sectors: prevCrag.sectors.filter(s => s.id !== sectorId)
    }));

    // Send delete request to server
    const formData = new FormData();
    formData.append('action', 'delete_sector');
    formData.append('sectorId', sectorId.toString());
    sectorDeleteFetcher.submit(formData, { method: 'post' });
  };

  const handleDeleteCrag = async () => {
    const formData = new FormData();
    formData.append('action', 'delete_crag');
    formData.append('cragId', crag.id.toString());
    
    deleteCragFetcher.submit(formData, { method: 'post' });
  };

  const handleCragNameSubmit = () => {
    if (cragName !== crag.name) {
      // Optimistically update the UI
      setCrag(prevCrag => ({
        ...prevCrag,
        name: cragName
      }));

      // Send update request to server
      const formData = new FormData();
      formData.append('action', 'update_crag_name');
      formData.append('cragId', crag.id.toString());
      formData.append('name', cragName);
      cragNameFetcher.submit(formData, { method: 'post' });
    }
    setIsEditingCragName(false);
  };

  return (
    <Container size="xl" py="xl">
      <Modal
        opened={deleteRouteId !== null}
        onClose={() => setDeleteRouteId(null)}
        title="Delete Route"
        size="sm"
      >
        <Stack>
          <Text>Are you sure you want to delete "{deleteRouteName}"?</Text>
          <Text size="sm" c="red">This action cannot be undone.</Text>
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setDeleteRouteId(null)}>Cancel</Button>
            <Button color="red" onClick={handleConfirmDelete}>Delete</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteCragModalOpen}
        onClose={() => setDeleteCragModalOpen(false)}
        title="Delete Crag"
        size="sm"
      >
        <Stack>
          <Text>Are you sure you want to delete "{crag.name}"?</Text>
          <Text size="sm" c="red">This action cannot be undone.</Text>
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setDeleteCragModalOpen(false)}>Cancel</Button>
            <Button color="red" onClick={handleDeleteCrag}>Delete</Button>
          </Group>
        </Stack>
      </Modal>

      <Stack gap="md">
        <Group justify="space-between" gap="xs">
          <Group gap="xs">
            <ActionIcon
              component={Link}
              to="/topos"
              variant="subtle"
              size="lg"
              color="gray"
              title="Back to Crags"
            >
              <IconArrowBack size={20} />
            </ActionIcon>
            {canEdit && isEditingCragName ? (
              <TextInput
                value={cragName}
                onChange={(event) => setCragName(event.currentTarget.value)}
                onBlur={handleCragNameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCragNameSubmit();
                  } else if (e.key === 'Escape') {
                    setCragName(crag.name);
                    setIsEditingCragName(false);
                  }
                }}
                size="xl"
                styles={{
                  input: {
                    fontSize: 'var(--mantine-font-size-h1)',
                    fontWeight: 'bold'
                  }
                }}
                autoFocus
              />
            ) : (
              <Title 
                order={1}
                style={{ 
                  cursor: canEdit ? 'pointer' : 'default' 
                }} 
                onClick={() => canEdit && setIsEditingCragName(true)}
              >
                {crag.name}
              </Title>
            )}
            {crag.statsPublicIssueCount && (
              <Badge circle color="red" size="lg" variant="filled">
                {crag.statsPublicIssueCount}
              </Badge>
            )}
            {canEdit && (
              <>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  title="Add Sector"
                  onClick={handleAddSector}
                >
                  <IconTextPlus size={20} />
                </ActionIcon>
                <ActionIcon
                  variant={sortingSectors ? "filled" : "subtle"}
                  color={sortingSectors ? "blue" : "gray"}
                  size="lg"
                  title={sortingSectors ? "Save Order" : "Sort Sectors"}
                  onClick={() => setSortingSectors(!sortingSectors)}
                  disabled={reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null}
                >
                  <IconArrowsUpDown size={20} />
                </ActionIcon>
                <ActionIcon
                  component={Link}
                  to={`/topos/importer?cragId=${crag.id}`}
                  variant="subtle"
                  color="gray"
                  size="lg"
                  title="Import Data"
                  disabled={reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null}
                >
                  <IconRobot size={20} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="lg"
                  title="Delete Crag"
                  onClick={() => setDeleteCragModalOpen(true)}
                  disabled={crag.sectors?.length > 0 || reorderingSectorId !== null || editingRouteId !== null || newRouteSectorId !== null}
                >
                  <IconTrash size={20} />
                </ActionIcon>
              </>
            )}
          </Group>
        </Group>

        <TopoGallery
          attachments={crag.attachments ?? []}
          cragId={crag.id}
          canEdit={canEdit ?? false}
          size="md"
        />

        <DragDropContext onDragEnd={handleReorderDragEnd}>
          <Droppable droppableId="sectors" type="sector" isDropDisabled={!sortingSectors}>
            {(provided: DroppableProvided) => (
              <Stack gap="md" ref={provided.innerRef} {...provided.droppableProps}>
                {crag.sectors?.map((sector, index) => (
                  <Draggable
                    key={sector.id}
                    draggableId={sector.id.toString()}
                    index={index}
                    isDragDisabled={!sortingSectors}
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
                        }}
                      >
                        <SectorCard
                          sector={sector}
                          theme={theme}
                          canEdit={!!canEdit}
                          editingRouteId={editingRouteId}
                          reorderingSectorId={reorderingSectorId}
                          newRouteSectorId={newRouteSectorId}
                          sortingSectors={sortingSectors}
                          onNewRoute={handleNewRoute}
                          onReorderingChange={setReorderingSectorId}
                          onEditClick={handleEditClick}
                          onCancelEdit={handleCancelEdit}
                          onCancelNewRoute={handleCancelNewRoute}
                          onDeleteClick={handleDeleteClick}
                          onSectorNameChange={handleSectorNameChange}
                          onDeleteSector={handleDeleteSector}
                          id={`sector-${sector.id}`}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </Stack>
            )}
          </Droppable>
        </DragDropContext>
      </Stack>
    </Container>
  );
}
