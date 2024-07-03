import { ActionFunctionArgs, redirect } from '@remix-run/cloudflare'
import { getAuthenticator } from '~/lib/auth.server'

export const loader = () => redirect('/login')

export const action = ({ request, context }: ActionFunctionArgs) => {
  return getAuthenticator(context).authenticate('google', request)
}