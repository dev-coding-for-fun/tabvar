import { getDB } from "./db";
import type { Sector } from "./models";

export async function createSector(context: any, cragId: number, name: string = "Untitled Sector") {
  try {
    const db = getDB(context);
    
    // Create the new sector
    const [newSector] = await db.insertInto('sector')
      .values({
        name,
        crag_id: cragId,
      })
      .returning(['id', 'name'])
      .execute();

    return { 
      success: true, 
      sector: {
        id: newSector.id,
        name: newSector.name,
        sort_order: -1 //despite sort_order being null,always return -1 on new sectors to appear at the top.
      }
    };
  } catch (error) {
    return { success: false, error: "Failed to create sector" };
  }
}

export async function updateSectorName(context: any, sectorId: number, name: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);
    await db.updateTable('sector')
      .set({ name })
      .where('id', '=', sectorId)
      .execute();

    return { success: true };
  } catch (error) {
    return { success: false, error: "Failed to update sector name" };
  }
}

export async function deleteSector(context: any, sectorId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDB(context);
    
    if (!sectorId) {
      return { success: false, error: "Missing sector id" };
    }

    // First check if the sector has any routes
    const routes = await db
      .selectFrom('route')
      .select('id')
      .where('sector_id', '=', sectorId)
      .execute();

    if (routes.length > 0) {
      return { success: false, error: "Cannot delete sector with routes" };
    }

    // If no routes, delete the sector
    await db.deleteFrom('sector')
      .where('id', '=', sectorId)
      .execute();

    return { success: true };
  } catch (error) {
    return { success: false, error: "Failed to delete sector" };
  }
} 