-- Migration number: 0016 	 2024-06-12T05:07:12.632Z
ALTER TABLE "route" ADD COLUMN first_ascent_by TEXT;
ALTER TABLE "route" ADD COLUMN first_ascent_date TIMESTAMP;
ALTER TABLE "route" ADD COLUMN route_built_date TIMESTAMP;
ALTER TABLE "route" ADD COLUMN route_length REAL;

ALTER TABLE crag ADD COLUMN latitude REAL;
ALTER TABLE crag ADD COLUMN longitude REAL;