// app/services/auth.server.ts
import { AppLoadContext, createCookieSessionStorage, redirect, type LoaderFunctionArgs } from 'react-router';
import { Authenticator } from 'remix-auth';
import { GoogleStrategy } from '@coji/remix-auth-google'
import { getDB } from './db';
import { sql } from 'kysely';
import { User } from './models';
import { applyInviteTagsToUser } from './tags.server';
import { getSafeRedirectTo } from './redirects';

const SESSION_USER_KEY = "user";

type AuthenticatorOptions = {
    failureRedirect?: string;
};

type AppAuthenticator = Authenticator<User> & {
    isAuthenticated(request: Request, options?: AuthenticatorOptions): Promise<User | null>;
};

function getSessionStorage(context: AppLoadContext) {
    const rawDomain = context.cloudflare.env.COOKIE_DOMAIN;
    // RFC 6265: Browsers reject cookies with Domain=localhost or Domain=127.0.0.1.
    const isLocalhost = !rawDomain || rawDomain === "localhost";

    return createCookieSessionStorage({
        cookie: {
            name: "_session",
            sameSite: "lax",
            path: "/",
            httpOnly: true,
            secrets: [context.cloudflare.env.COOKIE_SECRET],
            secure: context.cloudflare.env.ENVIRONMENT === "production",
            ...(isLocalhost ? {} : { domain: rawDomain }),
        },
    });
}

export async function getSessionUser(request: Request, context: AppLoadContext): Promise<User | null> {
    const sessionStorage = getSessionStorage(context);
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    return session.get(SESSION_USER_KEY) as User | null ?? null;
}

async function findOrCreateGoogleUser(context: AppLoadContext, tokens: Parameters<typeof GoogleStrategy.userProfile>[0]) {
    const profile = await GoogleStrategy.userProfile(tokens);
    const db = getDB(context);
    const { id, displayName, emails, photos } = profile;
    const rawEmail = emails?.[0]?.value;
    const avatarUrl = photos?.[0]?.value ?? null;

    if (!rawEmail) {
        throw new Error("Google profile did not include an email address");
    }
    const email = rawEmail.trim().toLowerCase();

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
        .where((eb) => eb.or([
            eb('uid', '=', id),
            eb('email', '=', email)
        ]))
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

        if (invite) {
            await applyInviteTagsToUser(db, email, user.uid, invite.invited_by_uid);
            await db.deleteFrom('user_invite_tag').where('email', '=', email).execute();
            await db.deleteFrom('user_invite').where('email', '=', email).execute();
        }
    } else {
        const invite = await db.selectFrom('user_invite')
            .selectAll()
            .where("email", "=", email)
            .executeTakeFirst();
        if (invite) {
            await applyInviteTagsToUser(db, email, user.uid, invite.invited_by_uid);
            await db.deleteFrom('user_invite_tag').where('email', '=', email).execute();
            await db.deleteFrom('user_invite').where('email', '=', email).execute();
        }

        const updates: {
            email_verified?: number;
            avatar_url?: string | null;
            display_name?: string;
        } = {};

        if (!user.emailVerified) {
            updates.email_verified = 1;
            user.emailVerified = true;
        }
        if (!user.avatarUrl && avatarUrl) {
            updates.avatar_url = avatarUrl;
            user.avatarUrl = avatarUrl;
        }
        if ((!user.displayName || user.displayName === email.split('@')[0]) && displayName) {
            updates.display_name = displayName;
            user.displayName = displayName;
        }

        if (Object.keys(updates).length > 0) {
            await db.updateTable('user')
                .set(updates)
                .where('uid', '=', user.uid)
                .execute();
        }
    }

    await db.insertInto('signin_event')
        .values({
            uid: user.uid,
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

    return redirect(getSafeRedirectTo(redirectTo) ?? "/topos", { headers });
}

export async function requireUser({ request, context, url }: LoaderFunctionArgs): Promise<User> {
    const authenticator = getAuthenticator(context);
    const redirectTo = encodeURIComponent(url.pathname + url.search);
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

async function hashToken(value: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function generateOtpCode(): string {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const code = (array[0] % 900000) + 100000;
    return code.toString();
}

export async function sendLoginEmail(
    context: AppLoadContext,
    email: string,
    redirectTo?: string
): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
        return { success: false, error: "Please enter a valid email address." };
    }

    const db = getDB(context);

    // Rate limit: Check if a token was already created for this email in the last 60 seconds
    const recentToken = await db
        .selectFrom("auth_token")
        .select(["id", "created_at as createdAt"])
        .where("email", "=", normalizedEmail)
        .where("created_at", ">", sql<string>`DATETIME('now', '-60 seconds')`)
        .executeTakeFirst();

    if (recentToken) {
        return {
            success: false,
            error: "Please wait 60 seconds before requesting another code.",
        };
    }

    // Prune expired tokens for hygiene
    await db
        .deleteFrom("auth_token")
        .where("expires_at", "<", sql<string>`DATETIME('now')`)
        .execute();

    const code = generateOtpCode();
    const token = crypto.randomUUID();
    const codeHash = await hashToken(code);

    await db
        .insertInto("auth_token")
        .values({
            email: normalizedEmail,
            code_hash: codeHash,
            token: token,
            expires_at: sql<string>`DATETIME('now', '+15 minutes')`,
            attempts: 0,
        })
        .execute();

    const baseUrl = context.cloudflare.env.BASE_URL || "https://app.tabvar.org";
    let magicLink = `${baseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    const safeRedirectTo = redirectTo ? getSafeRedirectTo(redirectTo) : null;
    if (safeRedirectTo) {
        magicLink += `&redirectTo=${encodeURIComponent(safeRedirectTo)}`;
    }
    const fromAddress = context.cloudflare.env.AUTH_FROM_EMAIL || "auth@tabvar.org";

    if (!context.cloudflare.env.EMAIL) {
        throw new Error("Cloudflare EMAIL binding is not configured");
    }

    await context.cloudflare.env.EMAIL.send({
        from: fromAddress,
        to: normalizedEmail,
        subject: `Your TABVAR Login Code: ${code}`,
        text: `Your TABVAR login code is: ${code}\n\nOr click this link to log in directly:\n${magicLink}\n\nThis code and link will expire in 15 minutes. If you did not request this, you can safely ignore this email.`,
        html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px; color: #18181b;">
        <h2 style="margin-top: 0; font-size: 20px;">Sign in to TABVAR</h2>
        <p style="color: #52525b; font-size: 15px; line-height: 1.5;">Enter the verification code below to sign in to your TABVAR account:</p>
        <div style="background-color: #f4f4f5; border-radius: 6px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #09090b; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #52525b; font-size: 15px; line-height: 1.5;">Or click the button below to sign in directly without typing the code:</p>
        <div style="text-align: center; margin: 20px 0;">
          <a href="${magicLink}" style="display: inline-block; background-color: #228be6; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 15px;">Sign In to TABVAR</a>
        </div>
        <hr style="border: none; border-top: 1px solid #eaeaea; margin: 24px 0;" />
        <p style="color: #71717a; font-size: 12px; margin-bottom: 0;">This code and link expire in 15 minutes. If you did not request this email, no further action is needed.</p>
      </div>
    `,
    });

    return { success: true };
}

export async function verifyAuthCode(
    context: AppLoadContext,
    email: string,
    code: string
): Promise<{ success: boolean; error?: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    const db = getDB(context);

    const record = await db
        .selectFrom("auth_token")
        .selectAll()
        .where("email", "=", normalizedEmail)
        .where("expires_at", ">", sql<string>`DATETIME('now')`)
        .orderBy("created_at", "desc")
        .executeTakeFirst();

    if (!record) {
        return {
            success: false,
            error: "Verification code expired or not found. Please request a new code.",
        };
    }

    if (record.attempts >= 5) {
        await db.deleteFrom("auth_token").where("id", "=", record.id).execute();
        return {
            success: false,
            error: "Too many incorrect attempts. Please request a new code.",
        };
    }

    const submittedHash = await hashToken(trimmedCode);
    if (submittedHash !== record.code_hash) {
        await db
            .updateTable("auth_token")
            .set({ attempts: record.attempts + 1 })
            .where("id", "=", record.id)
            .execute();

        return {
            success: false,
            error: "Invalid verification code. Please try again.",
        };
    }

    // Delete all tokens for this email once successfully verified
    await db
        .deleteFrom("auth_token")
        .where("email", "=", normalizedEmail)
        .execute();

    return { success: true };
}

export async function verifyMagicToken(
    context: AppLoadContext,
    token: string
): Promise<{ success: boolean; email?: string; error?: string }> {
    const trimmedToken = token.trim();
    const db = getDB(context);

    const record = await db
        .selectFrom("auth_token")
        .selectAll()
        .where("token", "=", trimmedToken)
        .where("expires_at", ">", sql<string>`DATETIME('now')`)
        .executeTakeFirst();

    if (!record) {
        return {
            success: false,
            error: "Login link is invalid or has expired.",
        };
    }

    // Delete all tokens for this email
    await db
        .deleteFrom("auth_token")
        .where("email", "=", record.email)
        .execute();

    return { success: true, email: record.email };
}

export async function findOrCreateEmailUser(
    context: AppLoadContext,
    email: string
): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();
    const db = getDB(context);

    let user = await db
        .selectFrom("user")
        .select([
            "uid",
            "email",
            "display_name as displayName",
            sql<boolean>`email_verified = 1`.as("emailVerified"),
            "provider_id as providerId",
            "avatar_url as avatarUrl",
            "role",
            "created_at as createdAt",
            "disclaimer_ack_date as disclaimerAckDate",
        ])
        .where("email", "=", normalizedEmail)
        .executeTakeFirst();

    if (!user) {
        const invite = await db
            .selectFrom("user_invite")
            .selectAll()
            .where("email", "=", normalizedEmail)
            .executeTakeFirst();

        const role = invite !== undefined ? invite.role : "anonymous";
        const uid = crypto.randomUUID();
        const displayName = normalizedEmail.split("@")[0] || "User";

        user = await db
            .insertInto("user")
            .values({
                uid,
                email: normalizedEmail,
                display_name: displayName,
                email_verified: 1,
                provider_id: "email",
                role,
            })
            .returning([
                "uid",
                "email",
                "display_name as displayName",
                sql<boolean>`email_verified = 1`.as("emailVerified"),
                "provider_id as providerId",
                "avatar_url as avatarUrl",
                "role",
                "created_at as createdAt",
                "disclaimer_ack_date as disclaimerAckDate",
            ])
            .executeTakeFirstOrThrow();

        if (invite) {
            await applyInviteTagsToUser(db, normalizedEmail, user.uid, invite.invited_by_uid);
            await db.deleteFrom("user_invite_tag").where("email", "=", normalizedEmail).execute();
            await db.deleteFrom("user_invite").where("email", "=", normalizedEmail).execute();
        }
    } else {
        const invite = await db
            .selectFrom("user_invite")
            .selectAll()
            .where("email", "=", normalizedEmail)
            .executeTakeFirst();
        if (invite) {
            await applyInviteTagsToUser(db, normalizedEmail, user.uid, invite.invited_by_uid);
            await db.deleteFrom("user_invite_tag").where("email", "=", normalizedEmail).execute();
            await db.deleteFrom("user_invite").where("email", "=", normalizedEmail).execute();
        }
        if (!user.emailVerified) {
            await db
                .updateTable("user")
                .set({ email_verified: 1 })
                .where("uid", "=", user.uid)
                .execute();
            user.emailVerified = true;
        }
    }

    await db
        .insertInto("signin_event")
        .values({
            uid: user.uid,
        })
        .returningAll()
        .executeTakeFirst();

    return user;
}