import { ActionFunctionArgs, redirect } from "@remix-run/cloudflare";
import { Form, Link } from "@remix-run/react";
import { logout } from "~/lib/auth.server";


export const action = async ({
  request,
}: ActionFunctionArgs) => {
  return logout(request);
};

export default function Logout() {
  return (
    <>
      <p>Are you sure you want to log out?</p>
      <Form method="post">
        <button>Logout</button>
      </Form>
      <Link to="/">Never mind</Link>
    </>
  );
}