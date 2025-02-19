import { json, type LoaderFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { Container, Title, Table } from "@mantine/core";
import { GoogleMap, LoadScript, Marker } from "@react-google-maps/api";
import { getDB } from "~/lib/db";
import { Crag } from "kysely-codegen";

interface LoaderData {
  crags: Crag[];
  googleMapsApiKey: string;
}

export const loader: LoaderFunction = async ({ context }) => {
  const db = getDB(context);
  const crags = await db
    .selectFrom("crag")
    .select(["id", "name", "latitude", "longitude"])
    .where("latitude", "is not", null)
    .where("longitude", "is not", null)
    .execute();
  const googleMapsApiKey = context.cloudflare.env.GOOGLE_MAPS_API_KEY;

  if (!googleMapsApiKey) {
    throw new Error("Google Maps API key is not configured");
  }

  return json({ crags, googleMapsApiKey });
};

const mapContainerStyle = {
  width: "100%",
  height: "600px",
};

const center = {
  lat: 51.1784, // Default center coordinates (approximately Banff area)
  lng: -115.5708,
};

export default function RoutesIndex() {
  const { crags, googleMapsApiKey } = useLoaderData<LoaderData>();

  return (
    <Container size="xl" p="md">
      <Title order={1} mb="md">Climbing Areas</Title>
      <LoadScript
        googleMapsApiKey={googleMapsApiKey}
        version="weekly"
        libraries={["places", "geometry"]}
      >
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={center}
          zoom={10}
          options={{
            mapTypeControl: true,
            streetViewControl: true,
          }}
        >
          {crags.map((crag) => 
            crag.latitude && crag.longitude ? (
              <Marker
                key={crag.id.toString()}
                position={{
                  lat: Number(crag.latitude),
                  lng: Number(crag.longitude),
                }}
                title={crag.name}
              />
            ) : null
          )}
        </GoogleMap>
      </LoadScript>

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
              <Table.Td>{crag.name}</Table.Td>
              <Table.Td>{crag.latitude?.toFixed(4)}</Table.Td>
              <Table.Td>{crag.longitude?.toFixed(4)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Container>
  );
}
