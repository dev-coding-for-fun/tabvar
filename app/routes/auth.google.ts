import { ActionFunctionArgs, redirect } from '@remix-run/cloudflare'
import { getAuthenticator, getSessionStorage } from '~/lib/auth.server'

export const loader = () => redirect('/login')

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const authenticator = getAuthenticator(context);
  const sessionStorage = getSessionStorage(context);
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));

  const formData = await request.clone().formData();
  let redirectTo = formData.get("redirectTo") as string | null;

  if (!redirectTo || !redirectTo.startsWith('/') || redirectTo.startsWith('//')) {
    redirectTo = "/topos";
  }

  session.set("postLoginRedirectTo", redirectTo);

  return authenticator.authenticate('google', request, {
    failureRedirect: '/login',
    throwOnError: true
  }).catch(async (error) => {
    if (error instanceof Response) {
        if (!error.headers.has('Set-Cookie')) {
            error.headers.append('Set-Cookie', await sessionStorage.commitSession(session));
        }
        throw error;
    }
    console.error("Error during Google auth initiation:", error);
    throw redirect("/login", {
        headers: {
            "Set-Cookie": await sessionStorage.commitSession(session)
        }
    });
  });
};