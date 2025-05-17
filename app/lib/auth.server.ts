// app/services/auth.server.ts
import { AppLoadContext, createCookieSessionStorage, redirect } from '@remix-run/cloudflare';
import { Authenticator } from 'remix-auth';
import { GoogleStrategy } from 'remix-auth-google'
import { getDB } from './db';
import { sql } from 'kysely';
import { User } from './models';

let _authenticator: Authenticator<User> | null = null;
let _sessionStorage: ReturnType<typeof createCookieSessionStorage> | null = null;


export function getAuthenticator(context: AppLoadContext): Authenticator<User> {
    if (_authenticator?.isAuthenticated !== undefined) return _authenticator;
    _sessionStorage  = createCookieSessionStorage({
        cookie: {
            name: "_session",
            sameSite: "lax",
            path: "/",
            httpOnly: true,
            secrets: [context.cloudflare.env.COOKIE_SECRET],
            secure: context.cloudflare.env.ENVIRONMENT === "production",
            domain: context.cloudflare.env.COOKIE_DOMAIN
        },
    });
    _authenticator = new Authenticator<User>(_sessionStorage);

    const googleStrategy = new GoogleStrategy<User>(
        {
            clientID: context.cloudflare.env.GOOGLE_CLIENT_ID ?? '',
            clientSecret: context.cloudflare.env.GOOGLE_CLIENT_SECRET ?? '',
            callbackURL: context.cloudflare.env.BASE_URL + '/auth/google/callback',
        },
        async ({ profile }) => {
            const db = getDB(context);
            const { id, displayName, emails, photos } = profile;
            const email = emails[0].value;
            const avatarUrl = photos[0].value;

            let user = await db.selectFrom('user')
                .select([
                    'uid', 
                    'email', 
                    'display_name as displayName',
                    sql<boolean>`email_verified = 1`.as('emailVerified'),
                    'provider_id as providerId', 
                    'avatar_url as avatarUrl', 
                    'role', 
                    'created_at as createdAt',
                    'disclaimer_ack_date as disclaimerAckDate'
                ])
                .where('uid', '=', id)
                .executeTakeFirst();
            if (!user) {
                const invite = await db.selectFrom('user_invite')
                    .selectAll()
                    .where("email", "=", email)
                    .executeTakeFirst();
                const role = (invite !== undefined) ? invite.role : "anonymous";
                user = await db.insertInto('user')
                    .values({
                        uid: id,
                        email: email,
                        display_name: displayName,
                        email_verified: 1,
                        provider_id: 'google',
                        avatar_url: avatarUrl,
                        role: role,
                    })
                    .returning([
                        'uid', 
                        'email', 
                        'display_name as displayName',
                        sql<boolean>`email_verified = 1`.as('emailVerified'),
                        'provider_id as providerId', 
                        'avatar_url as avatarUrl', 
                        'role', 
                        'created_at as createdAt',
                        'disclaimer_ack_date as disclaimerAckDate'
                    ])
                    .executeTakeFirstOrThrow();
            }
            await db.insertInto('signin_event')
                .values({
                    uid: id,
                })
                .returningAll().executeTakeFirst();
            
            return user;
        }
    );
    _authenticator.use(googleStrategy);
    return _authenticator;
}

export async function requireUser(
    request: Request,
    context: AppLoadContext
): Promise<User> {
    const authenticator = getAuthenticator(context);
    const currentPath = new URL(request.url).pathname;
    // Append current query parameters as well, so if user was at /somepage?param1=value1, they return there.
    const currentSearch = new URL(request.url).search;
    const redirectTo = encodeURIComponent(currentPath + currentSearch);
    const loginPathWithRedirect = `/login?redirectTo=${redirectTo}`;

    return authenticator.isAuthenticated(request, {
        failureRedirect: loginPathWithRedirect,
    });
}

export async function logout(request: Request) {
    if (!_sessionStorage) throw new Error("Session storage not initialized");
    
    const session = await _sessionStorage.getSession(request.headers.get("Cookie"));
    return redirect("/login", {
        headers: {
            "Set-Cookie": await _sessionStorage.destroySession(session),
        },
    });
}