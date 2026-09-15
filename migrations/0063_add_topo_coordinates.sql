-- Migration number: 0063 	 2026-09-12T21:44:14.244Z
-- Adds optional GPS coordinates (latitude, longitude) to topo table

ALTER TABLE "topo" ADD COLUMN "latitude" REAL;
ALTER TABLE "topo" ADD COLUMN "longitude" REAL;
