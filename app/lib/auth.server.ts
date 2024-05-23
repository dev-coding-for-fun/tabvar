// app/services/auth.server.ts
import { AppLoadContext } from '@remix-run/cloudflare';
import { Authenticator } from 'remix-auth';
import { GoogleStrategy } from 'remix-auth-google'
import { getDB } from './db';
import { sessionStorage } from './session.server';

export const authenticator = new Authenticator(sessionStorage);

function getGoogleStrategy(context: AppLoadContext) {
    const env = context.cloudflare.env as Env
    return new GoogleStrategy(
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
                    })
                    .returningAll().executeTakeFirst();
            }
            await db.insertInto('signin_event')
                .values({
                    uid: id,
                })
                .returningAll().executeTakeFirst();
            return user;
        }
    );
}

export function initAuth(context: AppLoadContext) {
    authenticator.use(getGoogleStrategy(context));
}