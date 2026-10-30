-- 2026 Golden Crowbar ballot. The deadline is December 4, 2026 at
-- 11:59:59 p.m. in Edmonton (December 5, 06:59:59 UTC).
INSERT INTO campaign (name, end_date)
SELECT '2026 Golden Crowbar Award', '2026-12-05 06:59:59'
WHERE NOT EXISTS (SELECT 1 FROM campaign WHERE name = '2026 Golden Crowbar Award');

WITH nominees(name) AS (VALUES
  ('Ethan Woodside'),
  ('Rhys Beaudry & Joel Freund'),
  ('Brendan Clark'),
  ('Jeff Moore'),
  ('Steve Fedyna'),
  ('Evan Hau'),
  ('Taylor Hertzsprung'),
  ('Daniel Padeanu'),
  ('Sara Lilley'),
  ('Chris Perry'),
  ('Marcus Norman'),
  ('Madison Marchuck'),
  ('Mason Tessier'),
  ('Grant Parkin'),
  ('Brian Garrison')
)
INSERT INTO campaign_candidate (campaign_id, name)
SELECT c.id, n.name FROM campaign c CROSS JOIN nominees n
WHERE c.name = '2026 Golden Crowbar Award'
  AND NOT EXISTS (
    SELECT 1 FROM campaign_candidate existing
    WHERE existing.campaign_id = c.id AND existing.name = n.name
  );
