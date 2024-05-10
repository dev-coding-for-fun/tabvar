-- Migration number: 0006 	 2024-05-08T22:52:32.615Z

CREATE TRIGGER update_route_sector_name AFTER UPDATE ON sector
FOR EACH ROW
BEGIN
    UPDATE route SET sector_name = NEW.name WHERE sector_id = NEW.id;
END;

CREATE TRIGGER update_route_crag_when_sector_moved AFTER UPDATE OF crag_id ON sector
FOR EACH ROW
BEGIN
    UPDATE route
    SET crag_name = (SELECT name FROM crag WHERE id = NEW.crag_id)
    WHERE sector_id = NEW.id;
END;

CREATE TRIGGER update_route_with_crag AFTER UPDATE ON crag
FOR EACH ROW
BEGIN
    UPDATE route SET crag_name = NEW.name WHERE sector_id IN (SELECT id FROM sector WHERE crag_id = NEW.id);
END;

CREATE TRIGGER delete_sector BEFORE DELETE ON sector
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, "Can't delete sector because routes still exist in the sector.  Delete routes first")
        WHERE EXISTS (SELECT 1 FROM route WHERE sector_id = OLD.id);
END;

CREATE TRIGGER delete_crag BEFORE DELETE ON crag
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, "Can't delete crag because sectors still exist in the sector.  Delete sectors (and routes within) first")
        WHERE EXISTS (SELECT 1 FROM sector WHERE crag_id = OLD.id);
END;


DROP TABLE "all_search";
DROP TABLE "route_search";

CREATE VIRTUAL TABLE "route_search" USING fts5(
    route_name,
    sector_name,
    crag_name,
    content='route',
    content_rowid='id');
