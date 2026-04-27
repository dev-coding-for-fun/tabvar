import { ActionFunctionArgs, type MetaFunction } from "react-router";
import { Form, Link } from "react-router";
import { logout } from "~/lib/auth.server";
import { privatePageMeta } from "~/lib/seo";

export const meta: MetaFunction = () => privatePageMeta("Sign out");

export const action = async ({
  request,
  context,
}: ActionFunctionArgs) => {
  return logout(request, context);
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