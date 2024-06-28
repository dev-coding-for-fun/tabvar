-- Migration number: 0026 	 2024-06-24T18:35:52.523Z
ALTER TABLE "crag" ADD COLUMN stats_active_issue_count INTEGER;
ALTER TABLE "crag" ADD COLUMN stats_public_issue_count INTEGER;
ALTER TABLE "crag" ADD COLUMN stats_issue_flagged INTEGER;
ALTER TABLE "issue" ADD COLUMN is_flagged BOOLEAN;
ALTER TABLE "issue" ADD COLUMN flagged_message TEXT;


CREATE TRIGGER update_stats_after_issue_insert
AFTER INSERT ON issue
FOR EACH ROW
BEGIN
    UPDATE crag SET 
        stats_active_issue_count = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('archived', 'closed', 'completed')),
        stats_public_issue_count = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('in moderation', 'archived', 'closed', 'completed')),
        stats_issue_flagged = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('archived', 'closed', 'completed')
            AND issue.is_flagged = 1)
    WHERE crag.id = (
        SELECT crag_id FROM sector JOIN route ON sector.id = route.sector_id WHERE route.id = NEW.route_id
    );
END;

CREATE TRIGGER update_stats_after_issue_update
AFTER UPDATE ON issue
FOR EACH ROW
BEGIN
    UPDATE crag SET
        stats_active_issue_count = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('archived', 'closed', 'completed')),
        stats_public_issue_count = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('in moderation', 'archived', 'closed', 'completed')),
        stats_issue_flagged = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('archived', 'closed', 'completed')
            AND issue.is_flagged = 1)
    WHERE crag.id IN (
        SELECT crag_id FROM sector JOIN route ON sector.id = route.sector_id 
        WHERE route.id = NEW.route_id OR route.id = OLD.route_id
    );
END;

CREATE TRIGGER update_stats_after_issue_delete
AFTER UPDATE ON issue
FOR EACH ROW
BEGIN
    UPDATE crag SET
        stats_active_issue_count = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('archived', 'closed', 'completed')),
        stats_public_issue_count = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('in moderation', 'archived', 'closed', 'completed')),
        stats_issue_flagged = (
            SELECT COUNT(*) 
            FROM issue JOIN route ON issue.route_id = route.id
            JOIN sector ON route.sector_id = sector.id
            WHERE sector.crag_id = crag.id
            AND lower(issue.status) NOT IN ('archived', 'closed', 'completed')
            AND issue.is_flagged = 1)
    WHERE crag.id = (
        SELECT crag_id FROM sector JOIN route ON sector.id = route.sector_id WHERE route.id = OLD.route_id
    );
END;

