import type { MetaFunction } from "@remix-run/cloudflare";
import { Link } from "@remix-run/react";

export const meta: MetaFunction = () => {
  return [
    { title: "Tabvar App" },
    {
      name: "description",
      content: "Welcome to TABVAR!",
    },
  ];
};

export default function Index() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <h1>Welcome</h1>
      <ul>
        <li>
          <Link to={`/issue/create`}>Create Issue</Link>
        </li>
      </ul>
    </div>
  );
}
