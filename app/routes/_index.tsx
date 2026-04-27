import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { publicPageMeta, DEFAULT_SITE_DESCRIPTION } from "~/lib/seo";

export const meta: MetaFunction = () => {
  return publicPageMeta({
    titlePhrase: "Home",
    description: DEFAULT_SITE_DESCRIPTION,
    pathname: "/",
  });
};

export default function Index() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <h1>Welcome</h1>
      <ul>
        <li>
          <Link to={`/issues/create`}>Create Issue</Link>
        </li><li>
          <Link to={`/issues/`}>View Issues</Link>
        </li><li>
          <Link to={`/issues/manage`}>Manage Issues</Link>
        </li><li>
          <Link to={`/topos`}>Routes & Topos</Link>
        </li><li>
          <Link to={`/goldencrowbar`}>Golden Crowbar Award</Link>
        </li>
      </ul>
    </div>
  );
}
