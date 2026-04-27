import { type LoaderFunctionArgs } from 'react-router'
import { createUserSession, getAuthenticator } from '~/lib/auth.server'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const cookieHeader = request.headers.get("Cookie");
  const cookies = cookieHeader ? Object.fromEntries(cookieHeader.split('; ').map(c => c.split('='))) : {};
  
  let finalRedirectTo = '/topos'; // Default redirect path

  if (cookies.redirectTo) {
    try {
      let decodedPath = decodeURIComponent(cookies.redirectTo);
      // Ensure the path is absolute
      if (!decodedPath.startsWith('/')) {
        decodedPath = `/${decodedPath}`;
      }
      finalRedirectTo = decodedPath;
    } catch (e) {
      console.error("Failed to decode redirectTo cookie, using default /topos:", e);
      // finalRedirectTo remains '/topos'
    }
  }

  try {
    const user = await getAuthenticator(context).authenticate('google', request);
    return createUserSession(request, context, user, finalRedirectTo);
  } catch (error) {
    if (error instanceof Response) throw error;
    throw error;
  }
}