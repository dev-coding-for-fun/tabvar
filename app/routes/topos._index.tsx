import { type LoaderFunction, type ActionFunction, data } from "@remix-run/cloudflare";
import { Link, useLoaderData, useFetcher } from "@remix-run/react";
import { Container, Title, Table, Anchor, Group, ActionIcon, Modal, TextInput, Button, Stack } from "@mantine/core";
import mapboxgl from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getDB } from "~/lib/db";
import { Crag, User } from "~/lib/models";
import { getAuthenticator } from "~/lib/auth.server";
import { IconMapPinPlus, IconEdit } from "@tabler/icons-react";
import { useMapboxContext } from "~/contexts/MapboxContext";

interface LoaderData {
  crags: Crag[];
  user: User | null;
}

export const action: ActionFunction = async ({ context, request }) => {
  const user = await getAuthenticator(context).isAuthenticated(request);
  if (!user || (user.role !== 'admin' && user.role !== 'super')) {
    return data({ error: 'Unauthorized' }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get('action')?.toString();

  switch (action) {
    case 'create_crag': {
      const name = formData.get('name')?.toString();
      if (!name) {
        return data({ error: 'Name is required' }, { status: 400 });
      }

      const db = getDB(context);
      const newCrag = await db
        .insertInto('crag')
        .values({
          name,
          latitude: null,
          longitude: null,
          created_at: new Date().toISOString()
        })
        .returning(['id', 'name', 'latitude', 'longitude'])
        .executeTakeFirst();

      return data({ success: true, crag: newCrag });
    }

    case 'update_position': {
      const cragId = formData.get('cragId');
      const latitude = formData.get('latitude');
      const longitude = formData.get('longitude');

      if (!cragId || !latitude || !longitude) {
        return data({ error: 'Missing required fields' }, { status: 400 });
      }

      const db = getDB(context);
      await db
        .updateTable('crag')
        .set({
          latitude: Number(latitude),
          longitude: Number(longitude)
        })
        .where('id', '=', Number(cragId))
        .execute();

      return data({ success: true });
    }

    default:
      return data({ error: `Unknown action: ${action}` }, { status: 400 });
  }
};

export const loader: LoaderFunction = async ({ context, request }) => {
  const db = getDB(context);
  const crags = await db
    .selectFrom("crag")
    .select(["id", "name", "latitude", "longitude"])
    .orderBy("name", "asc")
    .execute();
  
  const user = await getAuthenticator(context).isAuthenticated(request);

  return { crags, user };
};

export default function RoutesIndex() {
  const { crags: initialCrags, user } = useLoaderData<LoaderData>();
  const { mapboxAccessToken, mapboxStyleUrl } = useMapboxContext();
  const [crags, setCrags] = useState(initialCrags);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newCragName, setNewCragName] = useState('');
  const [editingCoordinatesId, setEditingCoordinatesId] = useState<number | null>(null);
  const [coordinateInput, setCoordinateInput] = useState('');
  const fetcher = useFetcher();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const newCragInputRef = useRef<HTMLInputElement>(null);
  const coordinateInputRef = useRef<HTMLInputElement>(null);
  const [placingCragId, setPlacingCragId] = useState<number | null>(null);
  const markers = useRef<{ [key: number]: mapboxgl.Marker }>({});
  const cragPositions = useRef<{ [key: number]: [number, number] }>({});
  const canEdit = user && (user.role === 'admin' || user.role === 'super');

  // Update local state when server data changes
  useEffect(() => {
    setCrags(initialCrags);
  }, [initialCrags]);

  // Add effect to focus input when modal opens
  useEffect(() => {
    if (isCreateDialogOpen) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        newCragInputRef.current?.focus();
      }, 50);
    }
  }, [isCreateDialogOpen]);

  const handleSetOnMap = (cragId: number) => {
    if (!map.current) return;
    
    // Get the center of the current map view
    const center = map.current.getCenter();
    const position: [number, number] = [center.lng, center.lat];
    
    // Store the position
    cragPositions.current[cragId] = position;
    
    // Remove existing marker if any
    const existingMarker = markers.current[cragId];
    if (existingMarker) {
      existingMarker.remove();
    }
    
    // Create new draggable marker
    const newMarker = createMarker(cragId, true);
    if (newMarker) {
      markers.current[cragId] = newMarker;
      setPlacingCragId(cragId);
    }
  };

  const handleCreateCrag = () => {
    if (!newCragName.trim()) return;

    const formData = new FormData();
    formData.append('action', 'create_crag');
    formData.append('name', newCragName.trim());

    fetcher.submit(formData, { method: 'post' });
    setIsCreateDialogOpen(false);
    setNewCragName('');
  };

  const createPopupHtml = (cragId: number, isMovable: boolean = false) => {
    const crag = crags.find(c => c.id === cragId);
    if (!crag) return '';
    
    return `
      <div style="text-align: center;">
        <h3 style="margin-bottom: 8px;">${crag.name}</h3>
        <a href="/topos/${encodeURIComponent(crag.id)}" style="color: #228BE6; text-decoration: none; display: block; margin-bottom: 8px;">
          View Routes
        </a>
        ${(user?.role === 'admin' || user?.role === 'super') ? `
          <a href="#" onclick="window.handleMovePin(${cragId}, ${isMovable}); return false;" style="color: #228BE6; text-decoration: none;">
            ${isMovable ? 'Save Position' : 'Move Pin'}
          </a>
        ` : ''}
      </div>
    `;
  };

  const createMarker = (cragId: number, isMovable: boolean = false) => {
    const position = cragPositions.current[cragId];
    if (!position) return null;

    const marker = new mapboxgl.Marker({
      color: isMovable ? '#ff0000' : '#3b82f6',
      scale: isMovable ? 1.2 : 1,
      draggable: isMovable
    })
      .setLngLat(position)
      .setPopup(new mapboxgl.Popup().setHTML(createPopupHtml(cragId, isMovable)))
      .addTo(map.current!);

    if (isMovable) {
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        cragPositions.current[cragId] = [lngLat.lng, lngLat.lat];
      });
    }

    return marker;
  };

  const handleSaveCoordinates = (cragId: number) => {
    // Split on any combination of commas, spaces, or tabs
    const values = coordinateInput.trim().split(/[\s,]+/).filter(Boolean);
    
    if (values.length !== 2) return;
    
    const [lat, lng] = values.map(n => Number(n.trim()));
    if (isNaN(lat) || isNaN(lng)) return;

    const formData = new FormData();
    formData.append('action', 'update_position');
    formData.append('cragId', cragId.toString());
    formData.append('latitude', lat.toString());
    formData.append('longitude', lng.toString());
    fetcher.submit(formData, { method: 'post' });

    setEditingCoordinatesId(null);
    setCoordinateInput('');
  };

  const startEditingCoordinates = (crag: Crag) => {
    setEditingCoordinatesId(crag.id);
    if (crag.latitude !== null && crag.longitude !== null) {
      setCoordinateInput(`${crag.latitude}, ${crag.longitude}`);
      // Use setTimeout to ensure the input is rendered before focusing
      setTimeout(() => {
        if (coordinateInputRef.current) {
          coordinateInputRef.current.focus();
          coordinateInputRef.current.select();
        }
      }, 50);
    } else {
      setCoordinateInput('');
      setTimeout(() => {
        coordinateInputRef.current?.focus();
      }, 50);
    }
  };

  // Effect for initial map setup and marker creation
  useEffect(() => {
    if (!mapContainer.current) return;
    
    if (!mapboxAccessToken || !mapboxStyleUrl) {
      console.error("Mapbox context not available in RoutesIndex");
      return; 
    }

    mapboxgl.accessToken = mapboxAccessToken;

    const isTouchDevice = (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapboxStyleUrl,
      center: [-115.5708, 51.1784], 
      zoom: 9,
      cooperativeGestures: isTouchDevice
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');

    // Add markers for each crag
    crags.filter(crag => crag.latitude && crag.longitude).forEach((crag) => {
      if (crag.latitude && crag.longitude) {
        const position: [number, number] = [Number(crag.longitude), Number(crag.latitude)];
        cragPositions.current[crag.id] = position;
        
        const marker = createMarker(crag.id);
        if (marker) {
          markers.current[crag.id] = marker;
        }
      }
    });

    // Add global handler for move pin clicks
    (window as any).handleMovePin = (cragId: number, isMovable: boolean) => {
      if (isMovable) {
        // Save the new position
        const position = cragPositions.current[cragId];
        if (position) {
          const formData = new FormData();
          formData.append('action', 'update_position');
          formData.append('cragId', cragId.toString());
          formData.append('latitude', position[1].toString());
          formData.append('longitude', position[0].toString());
          fetcher.submit(formData, { method: 'post' });
        }
        setEditingCoordinatesId(null); // Reset editing state after saving
        setPlacingCragId(null); // Reset placing state after saving
      } else {
        setEditingCoordinatesId(cragId); // Set this crag as the one being edited
      }
      
      // Remove existing marker
      const existingMarker = markers.current[cragId];
      if (existingMarker) {
        existingMarker.remove();
      }

      // Create new marker with updated appearance
      const newMarker = createMarker(cragId, !isMovable);
      if (newMarker) {
        markers.current[cragId] = newMarker;
      }
    };

    // Cleanup on unmount
    return () => {
      if (map.current) {
        map.current.remove();
      }
      delete (window as any).handleMovePin;
    };
  }, [mapboxAccessToken, mapboxStyleUrl, crags, user, fetcher]);

  return (
    <Container size="xl" p="md">
      <Modal
        opened={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        title="Create New Crag"
        size="sm"
      >
        <Stack>
          <TextInput
            label="Name"
            value={newCragName}
            onChange={(e) => setNewCragName(e.target.value)}
            placeholder="Enter crag name"
            ref={newCragInputRef}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleCreateCrag();
              }
            }}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCrag}>Create</Button>
          </Group>
        </Stack>
      </Modal>

      <Group gap="xs" mb="md" align="center">
        <Title order={1}>Climbing Areas</Title>
        <Anchor component={Link} to="/issues" ml="md">
          ⚠️ Route Issues
        </Anchor>
        {canEdit && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            title="Add Crag"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <IconMapPinPlus size={20} />
          </ActionIcon>
        )}
      </Group>
      <div ref={mapContainer} className="map-container-responsive" />

      <style>{`
        .map-container-responsive {
          width: 100%;
          height: 800px; /* Default height */
        }

        @media (max-width: 768px) { /* Corresponds to Mantine's 'sm' breakpoint */
          .map-container-responsive {
            height: 400px;
          }
        }
      `}</style>

      <Title order={2} mt="xl" mb="md">Crag List</Title>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Latitude</Table.Th>
            <Table.Th>Longitude</Table.Th>
            {canEdit && <Table.Th></Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crags.map((crag) => (
            <Table.Tr key={crag.id.toString()}>
              <Table.Td>
                <Group gap="xs">
                  <Anchor component={Link} to={`/topos/${crag.id}`} style={{ textDecoration: 'none' }}>
                    {crag.name}
                  </Anchor>
                  {canEdit && (!crag.latitude || !crag.longitude) && (
                    <Button
                      variant="light"
                      size="xs"
                      onClick={() => handleSetOnMap(crag.id)}
                      disabled={placingCragId === crag.id}
                    >
                      {placingCragId === crag.id ? 'Placing..' : 'Set on Map'}
                    </Button>
                  )}
                </Group>
              </Table.Td>
              {editingCoordinatesId === crag.id ? (
                <Table.Td colSpan={2}>
                  <Group gap="xs">
                    <TextInput
                      placeholder="latitude, longitude"
                      value={coordinateInput}
                      onChange={(e) => setCoordinateInput(e.target.value)}
                      style={{ width: '300px' }}
                      ref={coordinateInputRef}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveCoordinates(crag.id);
                        } else if (e.key === 'Escape') {
                          setEditingCoordinatesId(null);
                          setCoordinateInput('');
                        }
                      }}
                    />
                    <Button size="xs" onClick={() => handleSaveCoordinates(crag.id)}>Save</Button>
                    <Button size="xs" variant="subtle" onClick={() => {
                      setEditingCoordinatesId(null);
                      setCoordinateInput('');
                    }}>Cancel</Button>
                  </Group>
                </Table.Td>
              ) : (
                <>
                  <Table.Td>{crag.latitude?.toFixed(4)}</Table.Td>
                  <Table.Td>{crag.longitude?.toFixed(4)}</Table.Td>
                </>
              )}
              {canEdit && (
                <Table.Td>
                  {editingCoordinatesId !== crag.id && (
                    <ActionIcon
                      variant="subtle"
                      onClick={() => startEditingCoordinates(crag)}
                      title="Edit Coordinates"
                    >
                      <IconEdit size={16} />
                    </ActionIcon>
                  )}
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Container>
  );
}
