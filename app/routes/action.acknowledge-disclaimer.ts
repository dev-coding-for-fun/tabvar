import { ActionFunctionArgs, data } from "react-router";
import { getAuthenticator } from "~/lib/auth.server"; // Assuming auth.server.ts handles user auth
import { getDB } from "~/lib/db";


async function updateUserDisclaimerDate(userId: string, date: string, context: any) {

    const db = getDB(context);
    await db.updateTable("user")
    .set({ disclaimer_ack_date: date })
    .where("uid", "=", userId).execute();

  if (!userId) throw new Error("User ID is required for update.");
  return { success: true };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const authenticator = getAuthenticator(context);
  const user = await authenticator.isAuthenticated(request);

  if (!user) {
    return data({ error: "User not authenticated" }, { status: 401 });
  }

  try {
    const currentDate = new Date().toISOString();

    await updateUserDisclaimerDate(user.uid, currentDate, context);
    return data({ success: true, disclaimerAckDate: currentDate });
  } catch (error) {
    console.error("Failed to acknowledge disclaimer:", error);
    return data({ error: "Failed to update disclaimer acknowledgement." }, { status: 500 });
  }
} 