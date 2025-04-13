import { useFetcher, useLoaderData, useSubmit } from "@remix-run/react";
import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from "@remix-run/node";
import {
    Paper,
    Title,
    Container,
    Stack,
    Alert,
    Text,
    Table,
    Badge,
    Group,
    Box,
    Button
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconUpload, IconX, IconFile, IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect, useMemo } from "react";
import { getAuthenticator } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";
import { RequirePermission } from "~/components/RequirePermission";
import { getDB } from "~/lib/db";
import type { Crag, Sector } from "~/lib/models";

type RouteData = {
    Crag: string;
    Sector: string;
    Route: string;
    Difficulty: string;
    FirstAscencionist: string;
    FirstAscencionDate?: string;
    Year: number;
    "Pitch Count": number;
    Latitude: number;
    Longitude: number;
    ClimbStyle: string;
    "Topo URL": string;
    "Other URLs": string[];
    Extra: string;
};

type ActionData = { 
    error?: string; 
    success?: boolean;
    data?: RouteData[];
    message?: string;
    recordCount?: number;
    createdCrags?: any[];
    createdSectors?: any[];
    createdRoutes?: any[];
    updatedCrags?: any[];
    updatedSectors?: any[];
    updatedRoutes?: any[];
    createdNotes?: any[];
};

type SimpleCrag = {
    id: number;
    name: string;
    latitude: number | null;
    longitude: number | null;
};

type SimpleSector = {
    id: number;
    name: string;
    cragId: number | null;
    latitude: number | null;
    longitude: number | null;
};

type SimpleRoute = {
    id: number;
    name: string;
    sectorId: number | null;
    gradeYds: string | null;
    climbStyle: string | null;
    firstAscentBy: string | null;
    firstAscentDate: string | null;
    latitude: number | null;
    longitude: number | null;
    pitchCount: number | null;
    routeLength: number | null;
    year: number | null;
};

type LoaderData = {
    existingCrags: SimpleCrag[];
    existingSectors: SimpleSector[];
    existingRoutes: SimpleRoute[];
};

export async function loader({ context }: LoaderFunctionArgs) {
    const db = getDB(context);
    const crags = await db
        .selectFrom("crag")
        .select([
            "id",
            "name",
            "latitude",
            "longitude",
        ])
        .orderBy("name")
        .execute();

    const existingCrags: SimpleCrag[] = crags;

    // Load all sectors as well
    const sectors = await db
        .selectFrom("sector")
        .select([
            "id",
            "name",
            "crag_id as cragId",
            "latitude",
            "longitude",
        ])
        .execute();

    // Load all routes
    const routes = await db
        .selectFrom("route")
        .select([
            "id",
            "name",
            "sector_id as sectorId",
            "grade_yds as gradeYds",
            "climb_style as climbStyle",
            "first_ascent_by as firstAscentBy",
            "first_ascent_date as firstAscentDate",
            "latitude",
            "longitude",
            "pitch_count as pitchCount",
            "route_length as routeLength",
            "year",
        ])
        .execute();

    return json<LoaderData>({ 
        existingCrags,
        existingSectors: sectors,
        existingRoutes: routes
    });
}

export async function action({ request, context }: ActionFunctionArgs) {
    const user = await getAuthenticator(context).isAuthenticated(request, {
        failureRedirect: "/login",
    });
    if (user.role !== 'admin') {
        return json({ error: PERMISSION_ERROR });
    }

    const formData = await request.formData();
    const action = formData.get("action") as string | null;
    
    // Handle file upload
    if (formData.has("file")) {
        const file = formData.get("file") as File;
        
        if (!file) {
            return json({ error: "No file uploaded" });
        }

        try {
            const text = await file.text();
            console.log('File contents:', text);
            const data = JSON.parse(text) as RouteData[];
            console.log('Parsed data:', data);
            return json({ success: true, data });
        } catch (error) {
            console.error('Error processing file:', error);
            return json({ error: "Failed to parse JSON file" });
        }
    }
    
    // Common utility functions for all import/update actions
    const getRouteData = () => {
        const routeDataJson = formData.get("routeData") as string;
        if (!routeDataJson) {
            throw new Error("No route data provided");
        }
        return JSON.parse(routeDataJson) as RouteData[];
    };
    
    const normalizedStringMatch = (str1: string | undefined, str2: string | undefined): boolean => {
        if (!str1 || !str2) return false;
        
        const normalize = (str: string) => 
            str.toLowerCase()
               .replace(/\s+/g, ' ')
               .replace(/[\-–—]/g, '-')
               .trim();
        
        return normalize(str1) === normalize(str2);
    };
    
    // Try to fetch route data and handle common errors
    try {
        const db = getDB(context);
        let routeData: RouteData[];
        
        try {
            routeData = getRouteData();
        } catch (error) {
            return json({ error: "No route data provided" });
        }
        
        // Handle different types of actions
        if (action === "import_new_crags") {
            // Find unique new crags to create
            const existingCrags = await db
                .selectFrom("crag")
                .select(["name"])
                .execute();
                
            const existingCragNames = new Set(existingCrags.map(c => c.name.toLowerCase()));
            
            // Get unique crags from route data that don't exist yet
            const uniqueCrags = new Map<string, { name: string, lat: number | null, lng: number | null }>();
            
            for (const route of routeData) {
                const cragName = route.Crag;
                if (!cragName) continue;
                
                // Skip if already processed or if crag exists
                if (uniqueCrags.has(cragName.toLowerCase()) || 
                    existingCragNames.has(cragName.toLowerCase())) {
                    continue;
                }
                
                // Use any available coordinates for the new crag
                const lat = route.Latitude || null;
                const lng = route.Longitude || null;
                
                uniqueCrags.set(cragName.toLowerCase(), { 
                    name: cragName,
                    lat,
                    lng
                });
            }
            
            // Create all new crags
            const createdCrags = [];
            for (const crag of uniqueCrags.values()) {
                const result = await db
                    .insertInto("crag")
                    .values({
                        name: crag.name,
                        latitude: crag.lat,
                        longitude: crag.lng,
                        created_at: new Date().toISOString()
                    })
                    .returning(["id", "name"])
                    .executeTakeFirst();
                
                if (result) {
                    createdCrags.push(result);
                }
            }
            
            return json({ 
                success: true, 
                message: `Created ${createdCrags.length} new crags`,
                recordCount: createdCrags.length,
                createdCrags
            });
        }
        
        // For actions requiring entity matching, load the necessary data first
        const existingCrags = await db
            .selectFrom("crag")
            .select(["id", "name", "latitude", "longitude"])
            .execute();
            
        // Create helper functions for entity matching
        const findMatchingCrag = (cragName: string) => {
            // Try exact case-insensitive match first
            const exactMatch = existingCrags.find(crag => 
                crag.name.toLowerCase() === cragName.toLowerCase()
            );
            
            if (exactMatch) return exactMatch;
            
            // Try more flexible matching
            return existingCrags.find(crag => normalizedStringMatch(crag.name, cragName));
        };
        
        if (action === "import_new_sectors" || action === "import_new_routes" || 
            action === "update_sectors" || action === "update_routes") {
            // Load sectors for these actions
            const existingSectors = await db
                .selectFrom("sector")
                .select(["id", "name", "crag_id as cragId", "latitude", "longitude"])
                .execute();
                
            // Add sector matching function
            const findMatchingSector = (sectorName: string, cragId: number) => {
                // Try exact case-insensitive match first
                const exactMatch = existingSectors.find(sector => 
                    sector.name.toLowerCase() === sectorName.toLowerCase() && 
                    sector.cragId === cragId
                );
                
                if (exactMatch) return exactMatch;
                
                // Try more flexible matching
                return existingSectors.find(sector => 
                    normalizedStringMatch(sector.name, sectorName) && 
                    sector.cragId === cragId
                );
            };
            
            if (action === "import_new_sectors") {
                // Find unique new sectors to create
                const uniqueSectors = new Map<string, {
                    name: string;
                    cragId: number;
                    lat: number | null;
                    lng: number | null;
                }>();
                
                for (const route of routeData) {
                    if (!route.Sector || !route.Crag) continue;
                    
                    // Find matching crag
                    const matchingCrag = findMatchingCrag(route.Crag);
                    if (!matchingCrag) continue; // Skip if no matching crag found - should be created first
                    
                    // Create composite key: cragId:sectorName
                    const key = `${matchingCrag.id}:${route.Sector.toLowerCase()}`;
                    
                    // Skip if already processed or if sector already exists in this crag
                    if (uniqueSectors.has(key) || findMatchingSector(route.Sector, matchingCrag.id)) {
                        continue;
                    }
                    
                    // Use any available coordinates for the new sector
                    const lat = route.Latitude || null;
                    const lng = route.Longitude || null;
                    
                    uniqueSectors.set(key, { 
                        name: route.Sector,
                        cragId: matchingCrag.id,
                        lat,
                        lng
                    });
                }
                
                // Create all new sectors
                const createdSectors = [];
                for (const sector of uniqueSectors.values()) {
                    const result = await db
                        .insertInto("sector")
                        .values({
                            name: sector.name,
                            crag_id: sector.cragId,
                            latitude: sector.lat,
                            longitude: sector.lng,
                            created_at: new Date().toISOString()
                        })
                        .returning(["id", "name", "crag_id as cragId"])
                        .executeTakeFirst();
                    
                    if (result) {
                        createdSectors.push(result);
                    }
                }
                
                return json({ 
                    success: true, 
                    message: `Created ${createdSectors.length} new sectors`,
                    recordCount: createdSectors.length,
                    createdSectors
                });
            }
            
            if (action === "update_sectors") {
                // Process updates
                const updatedSectors = [];
                const processedSectorIds = new Set<number>();
                
                for (const route of routeData) {
                    if (!route.Sector || !route.Crag) continue;
                    
                    // Find matching crag and sector
                    const matchingCrag = findMatchingCrag(route.Crag);
                    if (!matchingCrag) continue;
                    
                    const matchingSector = findMatchingSector(route.Sector, matchingCrag.id);
                    if (!matchingSector) continue;
                    
                    // Skip if we've already processed this sector
                    if (processedSectorIds.has(matchingSector.id)) continue;
                    processedSectorIds.add(matchingSector.id);
                    
                    // Check if we need to update coordinates
                    if (route.Latitude || route.Longitude) {
                        const currentLat = matchingSector.latitude;
                        const currentLng = matchingSector.longitude;
                        const newLat = route.Latitude || null;
                        const newLng = route.Longitude || null;
                        
                        // Check if coordinates have changed
                        const hasCoordinateChanges = 
                            (currentLat !== newLat || currentLng !== newLng) &&
                            // At least one of the new coordinates must be non-null for an update
                            (newLat !== null || newLng !== null);

                        if (hasCoordinateChanges) {
                            // Update the sector
                            const result = await db
                                .updateTable("sector")
                                .set({
                                    latitude: newLat,
                                    longitude: newLng
                                })
                                .where("id", "=", matchingSector.id)
                                .returning(["id", "name", "crag_id as cragId", "latitude", "longitude"])
                                .executeTakeFirst();
                            
                            if (result) {
                                updatedSectors.push({
                                    ...result,
                                    updates: {
                                        coordinates: {
                                            from: { lat: currentLat, lng: currentLng },
                                            to: { lat: newLat, lng: newLng }
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                
                return json({ 
                    success: true, 
                    message: `Updated ${updatedSectors.length} sectors`,
                    recordCount: updatedSectors.length,
                    updatedSectors
                });
            }
            
            // For actions requiring route data
            if (action === "import_new_routes" || action === "update_routes") {
                // Load routes data for these actions
                const existingRoutes = await db
                    .selectFrom("route")
                    .select([
                        "id", 
                        "name", 
                        "sector_id as sectorId",
                        "grade_yds as gradeYds",
                        "climb_style as climbStyle",
                        "first_ascent_by as firstAscentBy",
                        "first_ascent_date as firstAscentDate",
                        "latitude",
                        "longitude",
                        "pitch_count as pitchCount",
                        "year"
                    ])
                    .execute();
                    
                // Add route matching function
                const findMatchingRoute = (routeName: string | undefined, sectorId: number | null) => {
                    if (!sectorId || !routeName) return null;
                    
                    // Try exact case-insensitive match first
                    const exactMatch = existingRoutes.find(route => 
                        route.name.toLowerCase() === routeName.toLowerCase() && 
                        route.sectorId === sectorId
                    );
                    
                    if (exactMatch) return exactMatch;
                    
                    // Try more flexible matching
                    return existingRoutes.find(route => 
                        normalizedStringMatch(route.name, routeName) && 
                        route.sectorId === sectorId
                    );
                };
                
                if (action === "import_new_routes") {
                    // Find unique routes to create
                    const uniqueRoutes = new Map<string, {
                        name: string;
                        sectorId: number;
                        gradeYds: string | null;
                        climbStyle: string | null;
                        firstAscentBy: string | null;
                        firstAscentDate: string | null;
                        year: number | null;
                        pitchCount: number | null;
                        latitude: number | null;
                        longitude: number | null;
                    }>();
                    
                    for (const route of routeData) {
                        if (!route.Route || !route.Sector || !route.Crag) continue;
                        
                        // Find matching crag and sector
                        const matchingCrag = findMatchingCrag(route.Crag);
                        if (!matchingCrag) continue;
                        
                        const matchingSector = findMatchingSector(route.Sector, matchingCrag.id);
                        if (!matchingSector) continue;
                        
                        // Create composite key: sectorId:routeName
                        const key = `${matchingSector.id}:${route.Route.toLowerCase()}`;
                        
                        // Skip if already processed or if route already exists in this sector
                        if (uniqueRoutes.has(key) || findMatchingRoute(route.Route, matchingSector.id)) {
                            continue;
                        }
                        
                        uniqueRoutes.set(key, { 
                            name: route.Route,
                            sectorId: matchingSector.id,
                            gradeYds: route.Difficulty || null,
                            climbStyle: route.ClimbStyle || null,
                            firstAscentBy: route.FirstAscencionist || null,
                            firstAscentDate: route.FirstAscencionDate || null,
                            year: route.Year || null,
                            pitchCount: route["Pitch Count"] || null,
                            latitude: route.Latitude || null,
                            longitude: route.Longitude || null
                        });
                    }
                    
                    // Create all new routes
                    const createdRoutes = [];
                    for (const routeInfo of uniqueRoutes.values()) {
                        const result = await db
                            .insertInto("route")
                            .values({
                                name: routeInfo.name,
                                sector_id: routeInfo.sectorId,
                                grade_yds: routeInfo.gradeYds,
                                climb_style: routeInfo.climbStyle,
                                first_ascent_by: routeInfo.firstAscentBy,
                                first_ascent_date: routeInfo.firstAscentDate,
                                year: routeInfo.year,
                                pitch_count: routeInfo.pitchCount,
                                latitude: routeInfo.latitude,
                                longitude: routeInfo.longitude,
                                created_at: new Date().toISOString()
                            })
                            .returning(["id", "name", "sector_id as sectorId"])
                            .executeTakeFirst();
                        
                        if (result) {
                            createdRoutes.push(result);
                        }
                    }
                    
                    return json({ 
                        success: true, 
                        message: `Created ${createdRoutes.length} new routes`,
                        recordCount: createdRoutes.length,
                        createdRoutes
                    });
                }
                
                if (action === "update_routes") {
                    // Process updates
                    const updatedRoutes = [];
                    const processedRouteIds = new Set<number>();
                    
                    for (const route of routeData) {
                        if (!route.Route || !route.Sector || !route.Crag) continue;
                        
                        // Find matching crag, sector, and route
                        const matchingCrag = findMatchingCrag(route.Crag);
                        if (!matchingCrag) continue;
                        
                        const matchingSector = findMatchingSector(route.Sector, matchingCrag.id);
                        if (!matchingSector) continue;
                        
                        const matchingRoute = findMatchingRoute(route.Route, matchingSector.id);
                        if (!matchingRoute) continue;
                        
                        // Skip if we've already processed this route
                        if (processedRouteIds.has(matchingRoute.id)) continue;
                        processedRouteIds.add(matchingRoute.id);
                        
                        // Check what fields need to be updated
                        const updates: Record<string, any> = {};
                        const fieldUpdates: Record<string, { from: any, to: any }> = {};
                        
                        // Check and add each field if it needs updating
                        const fieldMappings = [
                            { importField: 'Difficulty', dbField: 'grade_yds', updateKey: 'grade', existingValue: matchingRoute.gradeYds },
                            { importField: 'ClimbStyle', dbField: 'climb_style', updateKey: 'climbStyle', existingValue: matchingRoute.climbStyle },
                            { importField: 'FirstAscencionist', dbField: 'first_ascent_by', updateKey: 'firstAscentBy', existingValue: matchingRoute.firstAscentBy },
                            { importField: 'FirstAscencionDate', dbField: 'first_ascent_date', updateKey: 'firstAscentDate', existingValue: matchingRoute.firstAscentDate },
                            { importField: 'Year', dbField: 'year', updateKey: 'year', existingValue: matchingRoute.year },
                            { importField: 'Pitch Count', dbField: 'pitch_count', updateKey: 'pitchCount', existingValue: matchingRoute.pitchCount }
                        ];
                        
                        for (const mapping of fieldMappings) {
                            const importValue = route[mapping.importField as keyof RouteData];
                            if (importValue && importValue !== mapping.existingValue) {
                                updates[mapping.dbField] = importValue;
                                fieldUpdates[mapping.updateKey] = {
                                    from: mapping.existingValue,
                                    to: importValue
                                };
                            }
                        }
                        
                        // Coordinates require special handling
                        if ((route.Latitude || route.Longitude) &&
                            (route.Latitude !== matchingRoute.latitude || 
                            route.Longitude !== matchingRoute.longitude)) {
                            updates.latitude = route.Latitude || null;
                            updates.longitude = route.Longitude || null;
                            fieldUpdates.coordinates = {
                                from: { 
                                    lat: matchingRoute.latitude, 
                                    lng: matchingRoute.longitude 
                                },
                                to: { 
                                    lat: route.Latitude || null, 
                                    lng: route.Longitude || null 
                                }
                            };
                        }
                        
                        // Skip if no updates needed
                        if (Object.keys(updates).length === 0) continue;
                        
                        // Update the route
                        const result = await db
                            .updateTable("route")
                            .set(updates)
                            .where("id", "=", matchingRoute.id)
                            .returning([
                                "id", 
                                "name", 
                                "sector_id as sectorId",
                                "grade_yds as gradeYds",
                                "climb_style as climbStyle",
                                "first_ascent_by as firstAscentBy",
                                "first_ascent_date as firstAscentDate",
                                "latitude",
                                "longitude",
                                "pitch_count as pitchCount",
                                "year"
                            ])
                            .executeTakeFirst();
                        
                        if (result) {
                            updatedRoutes.push({
                                ...result,
                                updates: fieldUpdates
                            });
                        }
                    }
                    
                    return json({ 
                        success: true, 
                        message: `Updated ${updatedRoutes.length} routes`,
                        recordCount: updatedRoutes.length,
                        updatedRoutes
                    });
                }
            }
            
            if (action === "update_crags") {
                // Process updates
                const updatedCrags = [];
                const processedCragIds = new Set<number>();
                
                for (const route of routeData) {
                    if (!route.Crag) continue;
                    
                    // Find matching crag
                    const matchingCrag = findMatchingCrag(route.Crag);
                    if (!matchingCrag) continue;
                    
                    // Skip if we've already processed this crag
                    if (processedCragIds.has(matchingCrag.id)) continue;
                    processedCragIds.add(matchingCrag.id);
                    
                    // Check if we need to update coordinates
                    if (route.Latitude || route.Longitude) {
                        const currentLat = matchingCrag.latitude;
                        const currentLng = matchingCrag.longitude;
                        const newLat = route.Latitude || null;
                        const newLng = route.Longitude || null;
                        
                        // Check if coordinates have changed
                        const hasCoordinateChanges = 
                            (currentLat !== newLat || currentLng !== newLng) &&
                            // At least one of the new coordinates must be non-null for an update
                            (newLat !== null || newLng !== null);

                        if (hasCoordinateChanges) {
                            // Update the crag
                            const result = await db
                                .updateTable("crag")
                                .set({
                                    latitude: newLat,
                                    longitude: newLng
                                })
                                .where("id", "=", matchingCrag.id)
                                .returning(["id", "name", "latitude", "longitude"])
                                .executeTakeFirst();
                            
                            if (result) {
                                updatedCrags.push({
                                    ...result,
                                    updates: {
                                        coordinates: {
                                            from: { lat: currentLat, lng: currentLng },
                                            to: { lat: newLat, lng: newLng }
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                
                return json({ 
                    success: true, 
                    message: `Updated ${updatedCrags.length} crags`,
                    recordCount: updatedCrags.length,
                    updatedCrags
                });
            }
        }
        
        if (action === "import_topos_notes") {
            // Collect all existing entities for matching
            const existingCrags = await db
                .selectFrom("crag")
                .select(["id", "name"])
                .execute();
            
            const existingSectors = await db
                .selectFrom("sector")
                .select(["id", "name", "crag_id as cragId"])
                .execute();
            
            const existingRoutes = await db
                .selectFrom("route")
                .select(["id", "name", "sector_id as sectorId"])
                .execute();
            
            // Create helper functions for entity matching
            const findMatchingCrag = (cragName: string) => {
                // Try exact case-insensitive match first
                const exactMatch = existingCrags.find(crag => 
                    crag.name.toLowerCase() === cragName.toLowerCase()
                );
                
                if (exactMatch) return exactMatch;
                
                // Try more flexible matching
                return existingCrags.find(crag => normalizedStringMatch(crag.name, cragName));
            };
            
            const findMatchingSector = (sectorName: string, cragId: number) => {
                // Try exact case-insensitive match first
                const exactMatch = existingSectors.find(sector => 
                    sector.name.toLowerCase() === sectorName.toLowerCase() && 
                    sector.cragId === cragId
                );
                
                if (exactMatch) return exactMatch;
                
                // Try more flexible matching
                return existingSectors.find(sector => 
                    normalizedStringMatch(sector.name, sectorName) && 
                    sector.cragId === cragId
                );
            };
            
            const findMatchingRoute = (routeName: string, sectorId: number) => {
                // Try exact case-insensitive match first
                const exactMatch = existingRoutes.find(route => 
                    route.name.toLowerCase() === routeName.toLowerCase() && 
                    route.sectorId === sectorId
                );
                
                if (exactMatch) return exactMatch;
                
                // Try more flexible matching
                return existingRoutes.find(route => 
                    normalizedStringMatch(route.name, routeName) && 
                    route.sectorId === sectorId
                );
            };
            
            // Process each route data entry and create ImportNotes records
            const createdNotes = [];
            
            for (const routeData of getRouteData()) {
                // Skip entries without any notes, topos or URLs to import
                if (!routeData["Topo URL"] && 
                    (!routeData["Other URLs"] || routeData["Other URLs"].length === 0) && 
                    !routeData.Extra) {
                    continue;
                }
                
                // Find matching entities
                const matchingCrag = routeData.Crag ? findMatchingCrag(routeData.Crag) : null;
                if (!matchingCrag) continue;
                
                let matchingSector = null;
                let matchingRoute = null;
                
                if (routeData.Sector && matchingCrag) {
                    matchingSector = findMatchingSector(routeData.Sector, matchingCrag.id);
                }
                
                if (routeData.Route && matchingSector) {
                    matchingRoute = findMatchingRoute(routeData.Route, matchingSector.id);
                }
                
                // Determine which entity to link the notes to (route > sector > crag)
                let entityId: number | null = null;
                let entityType: string = '';
                
                if (matchingRoute) {
                    entityId = matchingRoute.id;
                    entityType = 'route';
                } else if (matchingSector) {
                    entityId = matchingSector.id;
                    entityType = 'sector';
                } else if (matchingCrag) {
                    entityId = matchingCrag.id;
                    entityType = 'crag';
                }
                
                // Skip if no entity to link to
                if (!entityId) continue;
                
                // Prepare data for ImportNotes record
                const otherUrls = routeData["Other URLs"] ? routeData["Other URLs"].join(', ') : null;
                
                // Create ImportNotes record
                const noteData: any = {};
                
                // Set only one of these fields based on entity type
                if (entityType === 'route') {
                    noteData.route_id = entityId;
                } else if (entityType === 'sector') {
                    noteData.sector_id = entityId;
                } else if (entityType === 'crag') {
                    noteData.crag_id = entityId;
                }
                
                // Add topo URL if available
                if (routeData["Topo URL"]) {
                    noteData.topo_url = routeData["Topo URL"];
                }
                
                // Add other URLs if available
                if (otherUrls) {
                    noteData.other_urls = otherUrls;
                }
                
                // Add extra notes if available
                if (routeData.Extra) {
                    noteData.notes = routeData.Extra;
                }
                
                // Insert the record
                const result = await db
                    .insertInto("import_notes")
                    .values(noteData)
                    .returning(["id", "crag_id", "sector_id", "route_id", "topo_url", "other_urls", "notes"])
                    .executeTakeFirst();
                
                if (result) {
                    // Add entity name information for better feedback
                    let entityName = '';
                    if (result.route_id) {
                        const route = existingRoutes.find(r => r.id === result.route_id);
                        entityName = route ? route.name : `Route #${result.route_id}`;
                    } else if (result.sector_id) {
                        const sector = existingSectors.find(s => s.id === result.sector_id);
                        entityName = sector ? sector.name : `Sector #${result.sector_id}`;
                    } else if (result.crag_id) {
                        const crag = existingCrags.find(c => c.id === result.crag_id);
                        entityName = crag ? crag.name : `Crag #${result.crag_id}`;
                    }
                    
                    createdNotes.push({
                        ...result,
                        entityName,
                        entityType
                    });
                }
            }
            
            return json({ 
                success: true, 
                message: `Created ${createdNotes.length} notes/topos`,
                recordCount: createdNotes.length,
                createdNotes
            });
        }
        
        // If no matching action was found
        return json({ error: "Invalid action" });
        
    } catch (error) {
        console.error(`Error processing ${action} action:`, error);
        return json({ error: `Failed to ${action?.replace(/_/g, ' ')}` });
    }
}

export default function JsonImporter() {
    const { existingCrags, existingSectors, existingRoutes } = useLoaderData<LoaderData>();
    const fetcher = useFetcher<ActionData>();
    const submit = useSubmit();
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [importMessage, setImportMessage] = useState<string | null>(null);

    // Log fetcher state changes
    useEffect(() => {
        console.log('Fetcher state changed:', fetcher.state);
        console.log('Fetcher data changed:', fetcher.data);
    }, [fetcher.state, fetcher.data]);

    // Log routes state changes
    useEffect(() => {
        console.log('Routes state changed:', routes);
        console.log('Routes length:', routes.length);
    }, [routes]);

    // Update routes when we get new data
    useEffect(() => {
        console.log('Checking fetcher data for routes update:', fetcher.data?.data);
        if (fetcher.data?.data) {
            console.log('Setting new routes:', fetcher.data.data);
            console.log('New routes length:', fetcher.data.data.length);
            setRoutes(fetcher.data.data);
        }
    }, [fetcher.data?.data]);

    // Handle fetcher state/data changes
    useEffect(() => {
        if (fetcher.data?.message) {
            let message = fetcher.data.message;
            if (fetcher.data.recordCount !== undefined) {
                message = `${fetcher.data.recordCount} new records imported`;
            }
            setImportMessage(message);
            
            // Refresh the page after successful import
            if (fetcher.data.success) {
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        }
    }, [fetcher.data]);

    const handleDrop = (files: File[]) => {
        const file = files[0];
        console.log('File dropped:', file?.type);
        if (file?.type === "application/json") {
            const formData = new FormData();
            formData.append("file", file);
            console.log('Submitting file...');
            fetcher.submit(formData, { 
                method: "post",
                encType: "multipart/form-data"
            });
        }
    };

    // Handle import new crags button click
    const handleImportNewCrags = () => {
        const formData = new FormData();
        formData.append("action", "import_new_crags");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };
    
    // Handle import new sectors button click
    const handleImportNewSectors = () => {
        const formData = new FormData();
        formData.append("action", "import_new_sectors");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };

    // Handle import new routes button click
    const handleImportNewRoutes = () => {
        const formData = new FormData();
        formData.append("action", "import_new_routes");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };

    // Handle update crags button click
    const handleUpdateCrags = () => {
        const formData = new FormData();
        formData.append("action", "update_crags");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };
    
    // Handle update sectors button click
    const handleUpdateSectors = () => {
        const formData = new FormData();
        formData.append("action", "update_sectors");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };
    
    // Handle update routes button click
    const handleUpdateRoutes = () => {
        const formData = new FormData();
        formData.append("action", "update_routes");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };

    // Handle import topos and notes button click
    const handleImportToposNotes = () => {
        const formData = new FormData();
        formData.append("action", "import_topos_notes");
        formData.append("routeData", JSON.stringify(routes));
        
        submit(formData, { method: "post" });
    };

    // Normalize and compare two strings for flexible matching
    const normalizedStringMatch = (str1: string | undefined, str2: string | undefined): boolean => {
        if (!str1 || !str2) return false;
        
        // Normalize string by:
        // 1. Converting to lowercase
        // 2. Removing extra spaces
        // 3. Normalizing dashes (replace all dash types with single dash)
        // 4. Removing trailing/leading spaces
        const normalize = (str: string) => 
            str.toLowerCase()
               .replace(/\s+/g, ' ')
               .replace(/[\-–—]/g, '-')
               .trim();
        
        return normalize(str1) === normalize(str2);
    };

    // Format coordinates to display consistently
    const formatCoords = (lat: number | null | undefined, lng: number | null | undefined): string => {
        return `${lat?.toFixed(6) ?? 'N/A'}, ${lng?.toFixed(6) ?? 'N/A'}`;
    };
    
    // Check if coordinates are different
    const coordsAreDifferent = (lat1: number | null | undefined, lng1: number | null | undefined, 
                                lat2: number | null | undefined, lng2: number | null | undefined): boolean => {
        return (lat1?.toFixed(6) !== lat2?.toFixed(6) || lng1?.toFixed(6) !== lng2?.toFixed(6));
    };
    
    // Generate coordinates difference display text
    const getCoordDiffText = (existingLat: number | null | undefined, existingLng: number | null | undefined,
                             newLat: number | null | undefined, newLng: number | null | undefined): string => {
        return `${formatCoords(existingLat, existingLng)} → ${formatCoords(newLat, newLng)}`;
    };

    // Component for displaying value differences with an arrow
    const ValueWithArrow = ({ 
        oldValue, 
        newValue, 
        badge = false,
        badgeColor = "blue",
        badgeVariant = "light" 
    }: { 
        oldValue: string | number | null | undefined, 
        newValue: string | number | null | undefined,
        badge?: boolean,
        badgeColor?: string,
        badgeVariant?: string
    }) => {
        const displayOld = oldValue ?? 'None';
        const displayNew = newValue ?? 'None';
        
        if (badge) {
            return (
                <Badge variant={badgeVariant} color={badgeColor}>
                    {displayOld} → {displayNew}
                </Badge>
            );
        }
        
        return (
            <Text size="sm">
                {displayOld} → {displayNew}
            </Text>
        );
    };

    // Find matching crag by name
    const findMatchingCrag = (cragName: string) => {
        // Debug output for "Mount Rundle - West"
        if (cragName.includes("Rundle")) {
            console.log("Trying to match Rundle crag:", cragName);
            
            // Show similar existing crags
            const similars = existingCrags.filter(crag => 
                crag.name.toLowerCase().includes("rundle")
            );
            console.log("Potential matches:", similars.map(c => ({id: c.id, name: c.name})));
        }
        
        // Try exact case-insensitive match first
        const exactMatch = existingCrags.find(crag => 
            crag.name.toLowerCase() === cragName.toLowerCase()
        );
        
        if (exactMatch) return exactMatch;
        
        // Try more flexible matching
        return existingCrags.find(crag => normalizedStringMatch(crag.name, cragName));
    };

    // Find matching sector by name and crag ID
    const findMatchingSector = (sectorName: string | undefined, cragId: number | null) => {
        if (!cragId || !sectorName) return null;
        
        // Try exact case-insensitive match first
        const exactMatch = existingSectors.find(sector => 
            sector.name.toLowerCase() === sectorName.toLowerCase() && 
            sector.cragId === cragId
        );
        
        if (exactMatch) return exactMatch;
        
        // Try more flexible matching
        return existingSectors.find(sector => 
            normalizedStringMatch(sector.name, sectorName) && 
            sector.cragId === cragId
        );
    };

    // Find matching route by name and sector ID
    const findMatchingRoute = (routeName: string | undefined, sectorId: number | null) => {
        if (!sectorId || !routeName) return null;
        
        // Try exact case-insensitive match first
        const exactMatch = existingRoutes.find(route => 
            route.name.toLowerCase() === routeName.toLowerCase() && 
            route.sectorId === sectorId
        );
        
        if (exactMatch) return exactMatch;
        
        // Try more flexible matching
        return existingRoutes.find(route => 
            normalizedStringMatch(route.name, routeName) && 
            route.sectorId === sectorId
        );
    };

    // Compare imported route with existing route and return differences
    const getRouteDifferences = (importedRoute: RouteData, existingRoute: SimpleRoute) => {
        const differences: Record<string, { importValue: any, existingValue: any }> = {};
        
        // Compare difficulty (grade)
        if (importedRoute.Difficulty && importedRoute.Difficulty !== existingRoute.gradeYds) {
            differences['grade'] = {
                importValue: importedRoute.Difficulty,
                existingValue: existingRoute.gradeYds
            };
        }
        
        // Compare pitch count
        if (importedRoute["Pitch Count"] && importedRoute["Pitch Count"] !== existingRoute.pitchCount) {
            differences['pitchCount'] = {
                importValue: importedRoute["Pitch Count"],
                existingValue: existingRoute.pitchCount
            };
        }
        
        // Compare coordinates (only if they apply to the route level)
        if ((importedRoute.Latitude || importedRoute.Longitude) && 
            coordsAreDifferent(existingRoute.latitude, existingRoute.longitude, 
                              importedRoute.Latitude, importedRoute.Longitude)) {
            differences['coordinates'] = {
                importValue: formatCoords(importedRoute.Latitude, importedRoute.Longitude),
                existingValue: formatCoords(existingRoute.latitude, existingRoute.longitude)
            };
        }
        
        // Compare first ascent date
        if (importedRoute.FirstAscencionDate && importedRoute.FirstAscencionDate !== existingRoute.firstAscentDate) {
            differences['firstAscentDate'] = {
                importValue: importedRoute.FirstAscencionDate,
                existingValue: existingRoute.firstAscentDate
            };
        }
        
        // Compare first ascensionist
        if (importedRoute.FirstAscencionist && importedRoute.FirstAscencionist !== existingRoute.firstAscentBy) {
            differences['firstAscentBy'] = {
                importValue: importedRoute.FirstAscencionist,
                existingValue: existingRoute.firstAscentBy
            };
        }
        
        // Compare climb style
        if (importedRoute.ClimbStyle && importedRoute.ClimbStyle !== existingRoute.climbStyle) {
            differences['climbStyle'] = {
                importValue: importedRoute.ClimbStyle,
                existingValue: existingRoute.climbStyle
            };
        }
        
        // Compare year
        if (importedRoute.Year && importedRoute.Year !== existingRoute.year) {
            differences['year'] = {
                importValue: importedRoute.Year,
                existingValue: existingRoute.year
            };
        }
        
        return differences;
    };

    return (
        <RequirePermission access="admin">
            <Container size="100%" py="xl">
                <Paper radius="md" p="xl" withBorder>
                    <Stack gap="md">
                        <Alert
                            icon={<IconAlertCircle size={16} />}
                            title="🚧 Under Construction 🚧"
                            color="red"
                            variant="light"
                        >
                            This feature is still being developed. The JSON import functionality is not yet ready for use.
                        </Alert>

                        <div>
                            <Title order={2}>Import Route Data</Title>
                            <Text c="dimmed" size="sm">
                                Upload a JSON file containing route data to import
                            </Text>
                        </div>

                        <Dropzone
                            onDrop={handleDrop}
                            accept={['application/json']}
                            multiple={false}
                        >
                            <Group justify="center" gap="xl" mih={220} style={{ pointerEvents: 'none' }}>
                                <Dropzone.Accept>
                                    <IconUpload size={50} stroke={1.5} className="text-blue-500" />
                                </Dropzone.Accept>
                                <Dropzone.Reject>
                                    <IconX size={50} stroke={1.5} className="text-red-500" />
                                </Dropzone.Reject>
                                <Dropzone.Idle>
                                    <IconFile size={50} stroke={1.5} />
                                </Dropzone.Idle>

                                <div>
                                    <Text size="xl" inline>
                                        Drag a JSON file here or click to select
                                    </Text>
                                    <Text size="sm" c="dimmed" inline mt={7}>
                                        The file should contain an array of route objects
                                    </Text>
                                </div>
                            </Group>
                        </Dropzone>

                        {fetcher.data?.error && (
                            <Alert
                                icon={<IconAlertCircle size={16} />}
                                title="Error"
                                color="red"
                                variant="light"
                            >
                                {fetcher.data.error}
                            </Alert>
                        )}

                        {routes.length > 0 && (
                            <Box style={{ width: '100%', overflowX: 'auto' }}>
                                <Title order={3} mb="md">Import Preview</Title>
                                
                                {/* Calculate which buttons should be enabled */}
                                {(() => {
                                    // Check if there are any new crags, sectors, or routes
                                    const hasNewCrags = routes.some(route => !findMatchingCrag(route.Crag));
                                    
                                    const hasNewSectors = routes.some(route => {
                                        const matchingCrag = findMatchingCrag(route.Crag);
                                        return matchingCrag && route.Sector && 
                                               !findMatchingSector(route.Sector, matchingCrag.id);
                                    });
                                    
                                    const hasNewRoutes = routes.some(route => {
                                        const matchingCrag = findMatchingCrag(route.Crag);
                                        if (!matchingCrag || !route.Sector) return false;
                                        const matchingSector = findMatchingSector(route.Sector, matchingCrag.id);
                                        return matchingSector && route.Route && 
                                               !findMatchingRoute(route.Route, matchingSector.id);
                                    });
                                    
                                    // Determine which buttons should be enabled based on hierarchy
                                    const enableImportNewCrags = hasNewCrags;
                                    const enableImportNewSectors = !hasNewCrags && hasNewSectors;
                                    const enableImportNewRoutes = !hasNewCrags && !hasNewSectors && hasNewRoutes;
                                    const enableUpdateButtons = !hasNewCrags && !hasNewSectors && !hasNewRoutes;
                                    
                                    return (
                                        <Stack gap="md" mb="xl">
                                            <Group>
                                                <Button 
                                                    color="green" 
                                                    disabled={!enableImportNewCrags}
                                                    onClick={handleImportNewCrags}
                                                >
                                                    Import New Crags
                                                </Button>
                                                <Button 
                                                    color="green" 
                                                    disabled={!enableImportNewSectors}
                                                    onClick={handleImportNewSectors}
                                                >
                                                    Import New Sectors
                                                </Button>
                                                <Button 
                                                    color="green" 
                                                    disabled={!enableImportNewRoutes}
                                                    onClick={handleImportNewRoutes}
                                                >
                                                    Import New Routes
                                                </Button>
                                            </Group>
                                            <Group>
                                                <Button 
                                                    color="yellow" 
                                                    disabled={!enableUpdateButtons}
                                                    onClick={handleUpdateCrags}
                                                >
                                                    Update Crags
                                                </Button>
                                                <Button 
                                                    color="yellow" 
                                                    disabled={!enableUpdateButtons}
                                                    onClick={handleUpdateSectors}
                                                >
                                                    Update Sectors
                                                </Button>
                                                <Button 
                                                    color="yellow" 
                                                    disabled={!enableUpdateButtons}
                                                    onClick={handleUpdateRoutes}
                                                >
                                                    Update Routes
                                                </Button>
                                            </Group>
                                            <Group>
                                                <Button 
                                                    color="blue" 
                                                    disabled={!enableUpdateButtons}
                                                    onClick={handleImportToposNotes}
                                                >
                                                    Import Topos and Notes
                                                </Button>
                                            </Group>
                                        </Stack>
                                    );
                                })()}
                                
                                {/* Show import message if available */}
                                {importMessage && (
                                    <Alert 
                                        color={fetcher.data?.success ? "green" : "red"}
                                        title={fetcher.data?.success ? "Success" : "Error"}
                                        mb="md"
                                        withCloseButton
                                        onClose={() => setImportMessage(null)}
                                    >
                                        {importMessage}
                                    </Alert>
                                )}
                                
                                <Table style={{ minWidth: '100%' }} highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                            <Table.Th style={{ width: '30%' }}>Hierarchy</Table.Th>
                                            <Table.Th style={{ width: '40%' }}>Route Details</Table.Th>
                                            <Table.Th style={{ width: '15%' }}>Location</Table.Th>
                                            <Table.Th style={{ width: '15%' }}>Status</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {routes.map((route, index) => {
                                            const matchingCrag = findMatchingCrag(route.Crag);
                                            const matchingSector = matchingCrag && route.Sector ? 
                                                findMatchingSector(route.Sector, matchingCrag.id) : 
                                                null;
                                            const matchingRoute = matchingCrag && matchingSector && route.Route ?
                                                findMatchingRoute(route.Route, matchingSector.id) :
                                                null;
                                            
                                            // Get route differences if we have a match
                                            const routeDifferences = matchingRoute && route.Route ? 
                                                getRouteDifferences(route, matchingRoute) : {};
                                            
                                            // Determine which level has coordinates in the import data
                                            const hasRouteCoords = route.Route && (route.Latitude || route.Longitude);
                                            const hasSectorCoords = !hasRouteCoords && route.Sector && (route.Latitude || route.Longitude);
                                            const hasCragCoords = !hasRouteCoords && !hasSectorCoords && (route.Latitude || route.Longitude);
                                            
                                        return (
                                                <>
                                                    {/* Imported data row */}
                                                    <Table.Tr key={`import-${index}`}>
                                                        <Table.Td>
                                                            <Stack gap="xs">
                                                                <Group gap="xs">
                                                                    <Badge color="blue" size="lg">Crag</Badge>
                                                                    <Text fw={500}>{route.Crag || 'Unnamed Crag'}</Text>
                                                                </Group>
                                                                {route.Sector && (
                                                                    <Group gap="xs" ml={10}>
                                                                        <Badge color="cyan" size="md">Sector</Badge>
                                                                        <Text>{route.Sector}</Text>
                                                                    </Group>
                                                                )}
                                                                {route.Route && (
                                                                    <Group gap="xs" ml={20}>
                                                                        <Badge color="violet" size="md">Route</Badge>
                                                                        <Text>{route.Route}</Text>
                                                                    </Group>
                                                                )}
                                                            </Stack>
                                                        </Table.Td>
                                                        <Table.Td>
                                                            <Group gap="md" wrap="nowrap" align="flex-start">
                                                                <Stack gap="xs">
                                                                    <Group gap="xs">
                                                                        <Badge variant="light" color="blue" size="lg">
                                                                            {route.Difficulty || 'Unknown'}
                                                                        </Badge>
                                                                        {route.Year && (
                                                                            <Text size="sm">
                                                                                ({route.Year})
                                                                            </Text>
                                                                        )}
                                                                    </Group>
                                                                    {route.FirstAscencionist && (
                                                                        <Text size="sm">
                                                                            FA: <Text span fw={500}>{route.FirstAscencionist}</Text>
                                                                        </Text>
                                                                    )}
                                                                </Stack>
                                                                <Stack gap="xs">
                                                                    {route["Pitch Count"] > 1 && (
                                                                        <Text size="sm">
                                                                            {route["Pitch Count"]} pitches
                                                                        </Text>
                                                                    )}
                                                                    {route.ClimbStyle && (
                                                                        <Group gap="xs">
                                                                            <Badge variant="dot" color="green">{route.ClimbStyle}</Badge>
                                                                        </Group>
                                                                    )}
                                                                    {route["Topo URL"] && (
                                                                        <Group gap="xs">
                                                                            <Badge variant="dot" color="orange">Topo</Badge>
                                                                        </Group>
                                                                    )}
                                                                </Stack>
                                                            </Group>
                                                        </Table.Td>
                                                        <Table.Td>
                                                            {(route.Latitude || route.Longitude) && (
                                                                <Group gap="xs">
                                                                    <Text size="sm">
                                                                        {hasRouteCoords && <Badge size="xs" variant="light">Route</Badge>}
                                                                        {hasSectorCoords && <Badge size="xs" variant="light">Sector</Badge>}
                                                                        {hasCragCoords && <Badge size="xs" variant="light">Crag</Badge>}
                                                                    </Text>
                                                                    <Text size="sm">
                                                                        {formatCoords(route.Latitude, route.Longitude)}
                                                                    </Text>
                                                                </Group>
                                                            )}
                                                        </Table.Td>
                                                <Table.Td>
                                                            <Stack gap="xs">
                                                                <Badge 
                                                                    color={matchingCrag ? "yellow" : "green"}
                                                                    size="lg"
                                                                >
                                                                    {matchingCrag ? "Update Crag" : "New Crag"}
                                                                </Badge>
                                                                {route.Sector && (
                                                                    <Badge 
                                                                        color={matchingSector ? "yellow" : "green"}
                                                                    >
                                                                        {matchingSector ? "Existing Sector" : "New Sector"}
                                                                    </Badge>
                                                                )}
                                                                {route.Route && (
                                                                    <Badge 
                                                                        color={matchingRoute ? "yellow" : "green"}
                                                                    >
                                                                        {matchingRoute ? "Update Route" : "New Route"}
                                                                    </Badge>
                                                                )}
                                                            </Stack>
                                                        </Table.Td>
                                                    </Table.Tr>

                                                    {/* Existing matches row */}
                                                    {(matchingCrag || matchingSector || matchingRoute) && (
                                                        <Table.Tr 
                                                            key={`existing-${index}`}
                                                            bg="gray.1"
                                                        >
                                                            <Table.Td colSpan={4}>
                                                                <Stack gap="md">
                                                                    {/* Crag match info */}
                                                                    {matchingCrag && (
                                                                        <Box>
                                                                            <Group gap="md">
                                                                                <Badge color="blue" variant="light">Existing Crag</Badge>
                                                                                <Text fw={500}>{matchingCrag.name}</Text>
                                                                            </Group>
                                                                            
                                                                            <Group gap="xl" mt="xs">
                                                                                {/* Only show crag coordinates if they're different from import coords */}
                                                                                {(hasCragCoords && 
                                                                                   coordsAreDifferent(
                                                                                       matchingCrag.latitude, matchingCrag.longitude,
                                                                                       route.Latitude, route.Longitude
                                                                                   )) && (
                                                                                    <Text size="sm">
                                                                                        Location: <Text span fw={500}>
                                                                                            {getCoordDiffText(
                                                                                                matchingCrag.latitude, matchingCrag.longitude,
                                                                                                route.Latitude, route.Longitude
                                                                                            )}
                                                                                        </Text>
                                                                                    </Text>
                                                                                )}
                                                                            </Group>
                                                                        </Box>
                                                                    )}
                                                                    
                                                                    {/* Sector match info */}
                                                                    {matchingSector && (
                                                                        <Box ml={10}>
                                                                            <Group gap="md">
                                                                                <Badge color="cyan" variant="light">Existing Sector</Badge>
                                                                                <Text fw={500}>{matchingSector.name}</Text>
                                                                            </Group>
                                                                            {/* Show sector coordinates if applicable and different */}
                                                                            {hasSectorCoords && coordsAreDifferent(matchingSector.latitude, matchingSector.longitude, 
                                                                                                                  route.Latitude, route.Longitude) && (
                                                                                <Group gap="xl" mt="xs">
                                                                                    <Text size="sm">
                                                                                        Location: <Text span fw={500}>
                                                                                            {matchingSector.latitude || matchingSector.longitude ? 
                                                                                                getCoordDiffText(matchingSector.latitude, matchingSector.longitude,
                                                                                                                 route.Latitude, route.Longitude) : 
                                                                                                `No coordinates → ${formatCoords(route.Latitude, route.Longitude)}`}
                                                                                        </Text>
                                                                                    </Text>
                                                                                </Group>
                                                                            )}
                                                                        </Box>
                                                                    )}

                                                                    {/* Route match info */}
                                                                    {matchingRoute && Object.keys(routeDifferences).length > 0 && (
                                                                        <Box ml={20}>
                                                                            <Group gap="md">
                                                                                <Badge color="violet" variant="light">Existing Route</Badge>
                                                                                <Text fw={500}>{matchingRoute.name}</Text>
                                                                            </Group>
                                                                            
                                                                            <Stack gap="xs" mt="xs">
                                                                                {/* Show differences */}
                                                                                {routeDifferences['grade'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">Grade:</Text>
                                                                                        <ValueWithArrow 
                                                                                            oldValue={routeDifferences['grade'].existingValue} 
                                                                                            newValue={routeDifferences['grade'].importValue} 
                                                                                            badge={true}
                                                                                            badgeColor="blue"
                                                                                        />
                                                                                    </Group>
                                                                                )}
                                                                                
                                                                                {routeDifferences['pitchCount'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">Pitches:</Text>
                                                                                        <ValueWithArrow oldValue={routeDifferences['pitchCount'].existingValue} newValue={routeDifferences['pitchCount'].importValue} />
                                                                                    </Group>
                                                                                )}
                                                                                
                                                                                {routeDifferences['firstAscentBy'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">FA:</Text>
                                                                                        <ValueWithArrow oldValue={routeDifferences['firstAscentBy'].existingValue} newValue={routeDifferences['firstAscentBy'].importValue} />
                                                                                    </Group>
                                                                                )}
                                                                                
                                                                                {routeDifferences['firstAscentDate'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">FA Date:</Text>
                                                                                        <ValueWithArrow oldValue={routeDifferences['firstAscentDate'].existingValue} newValue={routeDifferences['firstAscentDate'].importValue} />
                                                                                    </Group>
                                                                                )}
                                                                                
                                                                                {routeDifferences['year'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">Year:</Text>
                                                                                        <ValueWithArrow oldValue={routeDifferences['year'].existingValue} newValue={routeDifferences['year'].importValue} />
                                                                                    </Group>
                                                                                )}
                                                                                
                                                                                {routeDifferences['climbStyle'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">Style:</Text>
                                                                                        <ValueWithArrow 
                                                                                            oldValue={routeDifferences['climbStyle'].existingValue} 
                                                                                            newValue={routeDifferences['climbStyle'].importValue} 
                                                                                            badge={true}
                                                                                            badgeColor="green"
                                                                                            badgeVariant="dot"
                                                                                        />
                                                                                    </Group>
                                                                                )}
                                                                                
                                                                                {/* Only show coordinates if they're different */}
                                                                                {routeDifferences['coordinates'] && (
                                                                                    <Group gap="md">
                                                                                        <Text size="sm">Location:</Text>
                                                                                        <ValueWithArrow oldValue={routeDifferences['coordinates'].existingValue} newValue={routeDifferences['coordinates'].importValue} />
                                                                                    </Group>
                                                                                )}
                                                                            </Stack>
                                                                        </Box>
                                                                    )}
                                                                </Stack>
                                                </Table.Td>
                                            </Table.Tr>
                                                    )}
                                                </>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                            </Box>
                        )}
                    </Stack>
                </Paper>
            </Container>
        </RequirePermission>
    );
}
