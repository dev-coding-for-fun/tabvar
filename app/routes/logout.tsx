import { ActionFunctionArgs, redirect } from "@remix-run/cloudflare";
import { Form, Link } from "@remix-run/react";
import { destroySession, getSession } from "~/lib/session.server";


export const action = async ({
    request,
}: ActionFunctionArgs) => {
    const session = await getSession(
        request.headers.get("Cookie")
    );
    return redirect("/login", {
        headers: {
            "Set-Cookie": await destroySession(session),
        },
    });
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