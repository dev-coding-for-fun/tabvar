-- Migration number: 0054 	 2025-09-01T20:19:42.759Z

-- Create the 2025 Golden Crowbar Award campaign
INSERT INTO campaign (name, end_date) VALUES 
('2025 Golden Crowbar Award', '2025-12-31 23:59:59');

-- Insert all Golden Crowbar Award candidates using subquery to get campaign ID
INSERT INTO campaign_candidate (campaign_id, name) VALUES 
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Grant Parkin'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Dan Padeanu'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Steve Fedyna'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Marcus Norman'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Chris Perry'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Ross Suchy'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Andy Genereux'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Adam Matias'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Brendan Clark'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Mirko Arcais & Michele Hueber'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Matt Laird'),
((SELECT id FROM campaign WHERE name = '2025 Golden Crowbar Award'), 'Ben Firth');
