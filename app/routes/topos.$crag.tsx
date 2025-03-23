import { Container, Group, Paper, Stack, Text, Title, useMantineTheme, rem, Button, Box, Badge, ActionIcon, Modal } from "@mantine/core";
import { type LoaderFunction, type ActionFunction, data, redirect } from "@remix-run/cloudflare";
import { useLoaderData, Link, useSearchParams, useNavigate, useFetcher } from "@remix-run/react";
import { sql } from "kysely";
import { IconFlag, IconArrowBack, IconPencil, IconArrowsUpDown, IconPencilPlus, IconTrash, IconTextPlus } from "@tabler/icons-react";
import { getDB } from "~/lib/db";
import { useEffect, useRef, useState } from "react";
import type { Crag, Sector, Route } from "~/lib/models";
import { loadCragByName, deleteCrag } from "~/lib/crag.server";
import { getAuthenticator } from "~/lib/auth.server";
import type { User } from "~/lib/models";
import { DragDropContext, Droppable, Draggable, DropResult, DroppableProvided, DraggableProvided } from '@hello-pangea/dnd';
import { SectorCard } from "~/components/SectorCard";
import { createSector, updateSectorName, deleteSector } from "~/lib/sector.server";
import { createRoute, updateRoute, updateRouteOrder, deleteRoute } from "~/lib/route.server";

export const loader: LoaderFunction = async ({ params, context, request }) => {
  const cragName = params.crag;
  const user = await getAuthenticator(context).isAuthenticated(request);

  if (!cragName) {
    throw new Response("Crag name is required", { status: 400 });
  }

  try {
    const crag: Crag = await loadCragByName(context, cragName);
    
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
  const formData = await request.formData();
  const action = formData.get("action")?.toString();
  const user = await getAuthenticator(context).isAuthenticated(request);
  if (!user || (user.role !== 'admin' && user.role !== 'member')) {
    return data({ error: 'Unauthorized' }, { status: 403 });
  }
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

      const newRoute: Partial<Route> = {
        sectorId,
        name,
        gradeYds,
        climbStyle,
        boltCount,
        routeLength,
        firstAscentBy,
        pitchCount
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

      const updatedRoute: Partial<Route> = {
        id:routeId,
        name,
        gradeYds,
        climbStyle,
        boltCount,
        routeLength,
        firstAscentBy,
        pitchCount
      };

      return await updateRoute(context, updatedRoute);
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
  const editingRouteId = searchParams.get('editroute');
  const [reorderingSectorId, setReorderingSectorId] = useState<number | null>(null);
  const [newRouteSectorId, setNewRouteSectorId] = useState<number | null>(null);
  const [deleteRouteId, setDeleteRouteId] = useState<number | null>(null);
  const [deleteRouteName, setDeleteRouteName] = useState<string>("");
  const [sortingSectors, setSortingSectors] = useState(false);
  const [deleteCragModalOpen, setDeleteCragModalOpen] = useState(false);
  const deleteFetcher = useFetcher();
  const sectorNameFetcher = useFetcher();
  const sectorCreateFetcher = useFetcher();
  const sectorDeleteFetcher = useFetcher();
  const deleteCragFetcher = useFetcher();

  // Update local state when server data changes
  useEffect(() => {
    setCrag(initialCrag);
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

    await fetch(window.location.pathname, {
      method: 'POST',
      body: formData
    });
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    // Handle sector reordering
    if (result.type === 'sector') {
      await handleSectorReorder(
        [...crag.sectors],
        result.source.index,
        result.destination.index
      );
      return;
    }

    // Handle route reordering
    const sectorId = parseInt(result.source.droppableId);
    const sector = crag.sectors?.find(s => s.id === sectorId);
    if (!sector || !sector.routes) return;

    await handleRouteReorder(
      sectorId,
      [...sector.routes],
      result.source.index,
      result.destination.index
    );
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

      <Stack gap="lg">
        <Group justify="space-between" gap="xs" mb="xl">
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
            <Title order={1}>
              {crag.name}
            </Title>
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

        <DragDropContext onDragEnd={handleDragEnd}>
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
