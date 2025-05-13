import { ActionFunctionArgs, redirect } from '@remix-run/cloudflare'
import { getAuthenticator, getSessionStorage } from '~/lib/auth.server'

export const loader = async ({ request, context }: ActionFunctionArgs) => {
  const authenticator = getAuthenticator(context)
  const sessionStorage = getSessionStorage(context)
  const session = await sessionStorage.getSession(request.headers.get("Cookie"))

  try {
    // This will throw a redirect to /login on failure, committing the session.
    // On success, it returns the user and populates session.get('user').
    await authenticator.authenticate('google', request, {
      failureRedirect: '/login',
    })

    // If authenticate was successful, the user is now in the session.
    // Get our custom redirect path.
    const redirectTo = session.get("postLoginRedirectTo") || "/topos" // Default if not found
    
    // Clean up the postLoginRedirectTo from the session.
    session.unset("postLoginRedirectTo")

    // Commit the session (with user logged in and postLoginRedirectTo removed) and redirect.
    return redirect(redirectTo, {
      headers: {
        "Set-Cookie": await sessionStorage.commitSession(session),
      },
    })

  } catch (error) {
    // This catch is primarily for errors *not* handled by authenticate's failureRedirect
    // or if authenticate itself throws an unexpected error before it can redirect.
    // If error is a Response, it's likely the failureRedirect from authenticate; re-throw it.
    if (error instanceof Response) {
      throw error
    }

    // For other unexpected errors, log it and redirect to login.
    // It's good practice to clear any potentially sensitive session data or commit what we have.
    console.error("Unexpected error in Google callback:", error)
    // Ensure postLoginRedirectTo is cleared if it wasn't already before the error.
    if (session.has("postLoginRedirectTo")) {
        session.unset("postLoginRedirectTo")
    }
    return redirect("/login", {
        headers: {
            "Set-Cookie": await sessionStorage.commitSession(session)
        }
    })
  }
}