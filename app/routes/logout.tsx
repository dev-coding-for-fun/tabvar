import { ActionFunctionArgs, redirect, type MetaFunction } from "@remix-run/cloudflare";
import { Form, Link } from "@remix-run/react";
import { logout } from "~/lib/auth.server";
import { privatePageMeta } from "~/lib/seo";

export const meta: MetaFunction = () => privatePageMeta("Sign out");

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