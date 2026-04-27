import { ActionFunctionArgs, redirect } from 'react-router'
import { getAuthenticator } from '~/lib/auth.server'

export const loader = () => redirect('/login')

export const action = ({ request, context }: ActionFunctionArgs) => {
  return getAuthenticator(context).authenticate('google', request)
}