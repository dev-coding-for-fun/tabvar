import { ActionFunctionArgs, redirect } from '@remix-run/cloudflare'
import { authenticator } from '~/lib/auth.server'

export const loader = () => redirect('/login')

export const action = ({ request }: ActionFunctionArgs) => {
  return authenticator.authenticate('google', request)
}