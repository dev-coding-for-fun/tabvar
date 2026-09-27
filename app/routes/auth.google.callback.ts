import { type LoaderFunctionArgs } from 'react-router'
import { createUserSession, getAuthenticator } from '~/lib/auth.server'
import { getSafeRedirectTo } from '~/lib/redirects'

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const cookieHeader = request.headers.get("Cookie");
  const cookies = cookieHeader ? Object.fromEntries(cookieHeader.split('; ').map(c => c.split('='))) : {};
  
  let finalRedirectTo = '/topos'; // Default redirect path

  if (cookies.redirectTo) {
    try {
      finalRedirectTo = getSafeRedirectTo(decodeURIComponent(cookies.redirectTo)) ?? '/topos';
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