-- Migration number: 0039 	 2025-04-13T18:35:53.020Z
DROP TABLE IF EXISTS area;

ALTER TABLE crag DROP COLUMN has_sectors;