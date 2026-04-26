-- Migration number: 0055 	 2026-04-26T18:05:00.000Z

ALTER TABLE crag ADD COLUMN slug TEXT;

CREATE TABLE crag_slug_backfill AS
SELECT
  id,
  lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(name, 'é', 'e'), 'É', 'e'), ' ', '-'), char(39), ''), char(34), ''), '/', '-'), '&', 'and'), '.', ''), '-')) AS base_slug
FROM crag
WHERE slug IS NULL;

UPDATE crag_slug_backfill SET base_slug = replace(base_slug, '--', '-');
UPDATE crag_slug_backfill SET base_slug = replace(base_slug, '--', '-');
UPDATE crag_slug_backfill SET base_slug = replace(base_slug, '--', '-');
UPDATE crag_slug_backfill SET base_slug = replace(base_slug, '--', '-');
UPDATE crag_slug_backfill SET base_slug = trim(base_slug, '-');

UPDATE crag_slug_backfill
SET base_slug = 'crag-' || id
WHERE base_slug = '';

CREATE TABLE crag_slug_backfill_ranked AS
SELECT
  id,
  base_slug,
  count(*) OVER (PARTITION BY base_slug) AS duplicate_count,
  row_number() OVER (PARTITION BY base_slug ORDER BY id) AS duplicate_index
FROM crag_slug_backfill;

UPDATE crag
SET slug = (
  SELECT
    CASE
      WHEN ranked.duplicate_index = 1 THEN ranked.base_slug
      ELSE ranked.base_slug || '-' || ranked.duplicate_index
    END
  FROM crag_slug_backfill_ranked ranked
  WHERE ranked.id = crag.id
)
WHERE id IN (SELECT id FROM crag_slug_backfill_ranked);

DROP TABLE crag_slug_backfill_ranked;
DROP TABLE crag_slug_backfill;

CREATE UNIQUE INDEX crag_slug_uq ON crag(slug) WHERE slug IS NOT NULL;
