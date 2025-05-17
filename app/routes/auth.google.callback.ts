import { ActionFunctionArgs } from '@remix-run/cloudflare'
import { getAuthenticator } from '~/lib/auth.server'

export const loader = ({ request, context }: ActionFunctionArgs) => {
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

  return getAuthenticator(context).authenticate('google', request, {
    successRedirect: finalRedirectTo,
    failureRedirect: '/login',
  })
}