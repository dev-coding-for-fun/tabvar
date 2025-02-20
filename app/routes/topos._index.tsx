import { json, type LoaderFunction } from "@remix-run/cloudflare";
import { Link, useLoaderData } from "@remix-run/react";
import { Container, Title, Table, Anchor } from "@mantine/core";
import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getDB } from "~/lib/db";
import { Crag } from "kysely-codegen";

interface LoaderData {
  crags: Crag[];
  mapboxAccessToken: string;
  mapboxStyleUrl: string;
}

export const loader: LoaderFunction = async ({ context }) => {
  const db = getDB(context);
  const crags = await db
    .selectFrom("crag")
    .select(["id", "name", "latitude", "longitude"])
    .execute();
  
  const mapboxAccessToken = context.cloudflare.env.MAPBOX_ACCESS_TOKEN;
  const mapboxStyleUrl = context.cloudflare.env.MAPBOX_STYLE_URL;

  if (!mapboxAccessToken) {
    throw new Error("Mapbox access token is not configured");
  }

  if (!mapboxStyleUrl) {
    throw new Error("Mapbox style URL is not configured");
  }

  return json({ crags, mapboxAccessToken, mapboxStyleUrl });
};

export default function RoutesIndex() {
  const { crags, mapboxAccessToken, mapboxStyleUrl } = useLoaderData<LoaderData>();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    mapboxgl.accessToken = mapboxAccessToken;
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapboxStyleUrl,
      center: [-115.5708, 51.1784], // [longitude, latitude]
      zoom: 9
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Add markers for each crag
    crags.filter(crag => crag.latitude && crag.longitude).forEach((crag) => {
      if (crag.latitude && crag.longitude) {
        const marker = new mapboxgl.Marker()
          .setLngLat([Number(crag.longitude), Number(crag.latitude)])
          .setPopup(
            new mapboxgl.Popup().setHTML(
              `<div style="text-align: center;">
                <h3 style="margin-bottom: 8px;">${crag.name}</h3>
                <a href="/topos/${encodeURIComponent(crag.name)}" style="color: #228BE6; text-decoration: none;">
                  View Routes
                </a>
              </div>`
            )
          )
          .addTo(map.current!);
      }
    });

    // Cleanup on unmount
    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, [mapboxAccessToken, mapboxStyleUrl, crags]);

  return (
    <Container size="xl" p="md">
      <Title order={1} mb="md">Climbing Areas</Title>
      <div ref={mapContainer} style={{ height: "800px", width: "100%" }} />

      <Title order={2} mt="xl" mb="md">Crag List</Title>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Latitude</Table.Th>
            <Table.Th>Longitude</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {crags.map((crag) => (
            <Table.Tr key={crag.id.toString()}>
              <Table.Td>
                <Link to={`/topos/${encodeURIComponent(crag.name)}`} style={{ textDecoration: 'none' }}>
                  <Anchor>{crag.name}</Anchor>
                </Link>
              </Table.Td>
              <Table.Td>{crag.latitude?.toFixed(4)}</Table.Td>
              <Table.Td>{crag.longitude?.toFixed(4)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Container>
  );
}
