// app/services/auth.server.ts
import { AppLoadContext, createCookieSessionStorage, redirect } from 'react-router';
import { Authenticator } from 'remix-auth';
import { GoogleStrategy } from '@coji/remix-auth-google'
import { getDB } from './db';
import { sql } from 'kysely';
import { User } from './models';

const SESSION_USER_KEY = "user";

type AuthenticatorOptions = {
    failureRedirect?: string;
};

type AppAuthenticator = Authenticator<User> & {
    isAuthenticated(request: Request, options?: AuthenticatorOptions): Promise<User | null>;
};

function getSessionStorage(context: AppLoadContext) {
    return createCookieSessionStorage({
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
}

async function getSessionUser(request: Request, context: AppLoadContext): Promise<User | null> {
    const sessionStorage = getSessionStorage(context);
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    return session.get(SESSION_USER_KEY) as User | null ?? null;
}

async function findOrCreateGoogleUser(context: AppLoadContext, tokens: Parameters<typeof GoogleStrategy.userProfile>[0]) {
    const profile = await GoogleStrategy.userProfile(tokens);
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

export function getAuthenticator(context: AppLoadContext): AppAuthenticator {
    const authenticator = new Authenticator<User>() as AppAuthenticator;
    const googleStrategy = new GoogleStrategy<User>(
        {
            clientId: context.cloudflare.env.GOOGLE_CLIENT_ID ?? '',
            clientSecret: context.cloudflare.env.GOOGLE_CLIENT_SECRET ?? '',
            redirectURI: context.cloudflare.env.BASE_URL + '/auth/google/callback',
        },
        async ({ tokens }) => findOrCreateGoogleUser(context, tokens)
    );
    authenticator.use(googleStrategy);
    authenticator.isAuthenticated = async (request, options) => {
        const user = await getSessionUser(request, context);
        if (user) return user;
        if (options?.failureRedirect) throw redirect(options.failureRedirect);
        return null;
    };
    return authenticator;
}

export async function createUserSession(
    request: Request,
    context: AppLoadContext,
    user: User,
    redirectTo: string
) {
    const sessionStorage = getSessionStorage(context);
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    session.set(SESSION_USER_KEY, user);

    const headers = new Headers();
    headers.append("Set-Cookie", await sessionStorage.commitSession(session));
    headers.append("Set-Cookie", "redirectTo=; Path=/; Max-Age=0; SameSite=Lax");

    return redirect(redirectTo, { headers });
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

    const user = await authenticator.isAuthenticated(request, {
        failureRedirect: loginPathWithRedirect,
    });
    if (!user) throw redirect(loginPathWithRedirect);
    return user;
}

export async function logout(request: Request, context: AppLoadContext) {
    const sessionStorage = getSessionStorage(context);
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    return redirect("/login", {
        headers: {
            "Set-Cookie": await sessionStorage.destroySession(session),
        },
    });
}