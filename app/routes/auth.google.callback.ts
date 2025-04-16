import { ActionFunctionArgs } from '@remix-run/cloudflare'
import { getAuthenticator } from '~/lib/auth.server'

export const loader = ({ request, context }: ActionFunctionArgs) => {
  return getAuthenticator(context).authenticate('google', request, {
    successRedirect: '/issues',
    failureRedirect: '/login',
  })
}