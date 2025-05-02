import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as togeojson from '@mapbox/togeojson';
import { Loader, Alert, Center } from '@mantine/core';
import 'mapbox-gl/dist/mapbox-gl.css';

interface GpxMapViewerProps {
  gpxUrl: string;
  accessToken: string;
  styleUrl: string;
}

export function GpxMapViewer({ gpxUrl, accessToken, styleUrl }: GpxMapViewerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      map.current?.remove(); // Clean up map instance on unmount
    };
  }, []);

  useEffect(() => {
    if (!mapContainer.current || !accessToken || !styleUrl) return;

    mapboxgl.accessToken = accessToken;

    const initializeMap = (geojsonData: GeoJSON.FeatureCollection) => {
      if (!mapContainer.current || map.current) return; // Ensure container exists and map isn't already initialized

      try {
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: styleUrl,
          center: [0, 0], // Default center, will be adjusted
          zoom: 1, // Default zoom, will be adjusted
        });

        map.current.on('load', () => {
          if (!map.current) return; // Check if map still exists

          map.current.addSource('route', {
            type: 'geojson',
            data: geojsonData,
          });

          map.current.addLayer({
            id: 'route',
            type: 'line',
            source: 'route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#e33434', // Red color for the track
              'line-width': 3,
            },
          });

          // Calculate bounds
          const bounds = new mapboxgl.LngLatBounds();
          geojsonData.features.forEach(feature => {
            if (feature.geometry.type === 'LineString') {
              feature.geometry.coordinates.forEach(coord => {
                bounds.extend(coord as [number, number]);
              });
            }
            // Handle other geometry types if necessary (e.g., MultiLineString)
          });

          if (!bounds.isEmpty()) {
            map.current.fitBounds(bounds, {
              padding: 60, // Add padding around the track
              maxZoom: 16,
              duration: 0
            });
          }
        });

        map.current.on('error', (e) => {
          console.error('Mapbox error:', e);
          if (isMounted.current) {
             setError('Failed to load map details.');
          }
        });

      } catch (mapError) {
          console.error('Error initializing map:', mapError);
          if (isMounted.current) {
             setError('Failed to initialize map.');
          }
      }
    };

    setLoading(true);
    setError(null);

    fetch(gpxUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .then(gpxData => {
        if (!isMounted.current) return;
        try {
          const geojson = togeojson.gpx(new DOMParser().parseFromString(gpxData, 'text/xml'));
          if (!geojson || !geojson.features || geojson.features.length === 0) {
            throw new Error('Could not parse GPX data or GPX file is empty.');
          }
          initializeMap(geojson as GeoJSON.FeatureCollection);
        } catch (parseError) {
          console.error('Error parsing GPX:', parseError);
          setError('Failed to parse GPX file.');
        }
      })
      .catch(fetchError => {
        console.error('Error fetching GPX:', fetchError);
        if (isMounted.current) {
          setError('Failed to load GPX track data.');
        }
      })
      .finally(() => {
        if (isMounted.current) {
          setLoading(false);
        }
      });

  }, [gpxUrl, accessToken, styleUrl]); // Re-run effect if these change

  return (
    <div style={{ position: 'relative', width: '100%', height: '60vh' }}>
      {loading && (
        <Center style={{ height: '100%' }}>
          <Loader />
        </Center>
      )}
      {error && (
        <Alert title="Error" color="red" style={{ margin: '10px' }}>
          {error}
        </Alert>
      )}
      <div ref={mapContainer} style={{ position: 'absolute', top: 0, bottom: 0, width: '100%', visibility: loading || error ? 'hidden' : 'visible' }} />
    </div>
  );
} 