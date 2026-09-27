import { type LoaderFunctionArgs, redirect } from 'react-router';
import { createUserSession, findOrCreateEmailUser, verifyMagicToken } from '~/lib/auth.server';
import { getSafeRedirectTo } from '~/lib/redirects';

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return redirect('/login?error=missing_token');
  }

  const result = await verifyMagicToken(context, token);
  if (!result.success || !result.email) {
    return redirect(`/login?error=${encodeURIComponent(result.error || 'invalid_token')}`);
  }

  const cookieHeader = request.headers.get('Cookie');
  const cookies = cookieHeader
    ? Object.fromEntries(cookieHeader.split('; ').map((c) => c.split('=')))
    : {};
  const queryRedirectTo = getSafeRedirectTo(url.searchParams.get('redirectTo'));
  let cookieRedirectTo: string | null = null;

  if (cookies.redirectTo) {
    try {
      cookieRedirectTo = getSafeRedirectTo(decodeURIComponent(cookies.redirectTo));
    } catch {
      // fallback to /topos
    }
  }
  const finalRedirectTo = queryRedirectTo ?? cookieRedirectTo ?? '/topos';

  const user = await findOrCreateEmailUser(context, result.email);
  return createUserSession(request, context, user, finalRedirectTo);
};
