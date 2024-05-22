import { ActionFunctionArgs } from '@remix-run/cloudflare'
import { authenticator } from '~/lib/auth.server'

export const loader = ({ request }: ActionFunctionArgs) => {
  return authenticator.authenticate('google', request, {
    successRedirect: '/issues',
    failureRedirect: '/login',
  })
}