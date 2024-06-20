// app/services/auth.server.ts
import { AppLoadContext } from '@remix-run/cloudflare';
import { Authenticator } from 'remix-auth';
import { GoogleStrategy } from 'remix-auth-google'
import { getDB } from './db';
import { sessionStorage } from './session.server';
import { Generated, User } from 'kysely-codegen';

export const authenticator = new Authenticator<User>(sessionStorage);

function getGoogleStrategy(context: AppLoadContext): GoogleStrategy<User> {
    const env = context.cloudflare.env as Env
    return new GoogleStrategy<User>(
        {
            clientID: env.GOOGLE_CLIENT_ID ?? '',
            clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
            callbackURL: env.BASE_URL + '/auth/google/callback',
        },
        async ({ profile }) => {
            const db = getDB(context);
            const { id, displayName, emails, photos } = profile;
            const email = emails[0].value;
            const avatarUrl = photos[0].value;

            let user = await db.selectFrom('user')
                .selectAll()
                .where('uid', '=', id)
                .executeTakeFirst();
            if (!user) {
                user = await db.insertInto('user')
                    .values({
                        uid: id,
                        email: email,
                        display_name: displayName,
                        email_verified: 1,
                        provider_id: 'google',
                        avatar_url: avatarUrl,
                        role: "anonymous",
                    })
                    .returningAll().executeTakeFirstOrThrow();
            }
            await db.insertInto('signin_event')
                .values({
                    uid: id,
                })
                .returningAll().executeTakeFirst();
            return {
                ...user,
                created_at: user.created_at as unknown as Generated<string | null>
            };
        }
    );
}

export function initAuth(context: AppLoadContext) {
    authenticator.use(getGoogleStrategy(context));
}