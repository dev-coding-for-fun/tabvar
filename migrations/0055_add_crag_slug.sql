-- Migration number: 0055 	 2026-04-26T18:05:00.000Z

ALTER TABLE crag ADD COLUMN slug TEXT;

WITH normalized AS (
  SELECT
    id,
    lower(
      trim(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(name, 'é', 'e'),
                    'É',
                    'e'
                  ),
                  ' ',
                  '-'
                ),
                  '''',
                  ''
                ),
                '"',
                ''
              ),
              '/',
              '-'
            ),
            '&',
            'and'
          ),
          '.',
          ''
        ),
        '-'
      )
    ) AS base_slug
  FROM crag
  WHERE slug IS NULL
),
slugged AS (
  SELECT
    id,
    CASE
      WHEN base_slug = '' THEN 'crag-' || id
      ELSE base_slug
    END AS base_slug
  FROM normalized
),
ranked AS (
  SELECT
    id,
    base_slug,
    row_number() OVER (PARTITION BY base_slug ORDER BY id) AS duplicate_index
  FROM slugged
)
UPDATE crag
SET slug = (
  SELECT
    CASE
      WHEN ranked.duplicate_index = 1 THEN ranked.base_slug
      ELSE ranked.base_slug || '-' || ranked.duplicate_index
    END
  FROM ranked
  WHERE ranked.id = crag.id
)
WHERE slug IS NULL;

CREATE UNIQUE INDEX crag_slug_uq ON crag(slug) WHERE slug IS NOT NULL;
