import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import '@mantine/core/styles.layer.css';
import 'mantine-datatable/styles.layer.css';
import '@mantine/notifications/styles.css';
import './styles/custom.css';
import './styles/header.css';
import { ColorSchemeScript, DEFAULT_THEME, MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from "@mantine/notifications";
import { LoaderFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { getAuthenticator } from "~/lib/auth.server";
import type { User } from "~/lib/models";
import { UserProvider } from "./lib/hooks/useUser";
import { EditorMenu } from "./components/EditorMenu";

const theme = createTheme({
  primaryColor: 'blue',
  colors: {
    'route-color': DEFAULT_THEME.colors.blue,
    'sector-color': DEFAULT_THEME.colors.grape,
    'crag-color': DEFAULT_THEME.colors.violet,
    'status-in-moderation': DEFAULT_THEME.colors.pink,
    'status-reported': DEFAULT_THEME.colors.indigo,
    'status-viewed': DEFAULT_THEME.colors.indigo,
    'status-completed': DEFAULT_THEME.colors.green,
    'status-archived': DEFAULT_THEME.colors.red,
  },
  fontFamily: "'Lato', sans-serif",
})

export const loader: LoaderFunction = async ({ request, context }) => {
  const user = await getAuthenticator(context).isAuthenticated(request);
  return { user };
};

export default function App() {
  const { user } = useLoaderData<{ user: User | null }>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <ColorSchemeScript />
      </head>
      <body>
        <header>
          <div className="header-container">
            <a href="https://www.tabvar.org/home" aria-hidden="false">
              <img src="../tabvar.png" alt="TABVAR" className="logo"/>
            </a>
            <nav className="main-navigation" role="navigation">
              <ul className="nav-list">
                <li className="nav-item">
                  <a href="https://www.tabvar.org/home" className="nav-link">Home</a>
                </li>
                <li className="nav-item">
                  <a href="https://www.tabvar.org/donatenew" className="nav-link">Donate</a>
                </li>
                <li className="nav-item has-submenu">
                  <a href="https://www.tabvar.org/routebuilders" className="nav-link" aria-expanded="false" aria-haspopup="true">Routebuilders Section</a>
                  <svg viewBox="0 0 24 24" stroke="currentColor" focusable="false"><g transform="translate(9.7,12) rotate(45)"><path d="M-4.2 0 L4.2 0" strokeWidth="2"></path></g><g transform="translate(14.3,12) rotate(-45)"><path className="MrYMx" d="M-4.2 0 L4.2 0" strokeWidth="2"></path></g></svg>
                  <div className="submenu">
                    <ul className="submenu-list">
                      <li className="submenu-item">
                        <a href="https://www.tabvar.org/routebuilders/submission-and-funding" className="submenu-link">Submission and Funding</a>
                      </li>
                      <li className="submenu-item">
                        <a href="https://www.tabvar.org/routebuilders/bulk-hardware-orders" className="submenu-link">Bulk Hardware Orders</a>
                      </li>
                    </ul>
                  </div>
                </li>
                <li className="nav-item">
                  <a href="https://www.tabvar.org/supporters" className="nav-link">Supporters</a>
                </li>
                <li className="nav-item has-submenu">
                  <a href="https://www.tabvar.org/about" className="nav-link" aria-expanded="false" aria-haspopup="true">About</a>
                  <svg viewBox="0 0 24 24" stroke="currentColor" focusable="false"><g transform="translate(9.7,12) rotate(45)"><path d="M-4.2 0 L4.2 0" strokeWidth="2"></path></g><g transform="translate(14.3,12) rotate(-45)"><path className="MrYMx" d="M-4.2 0 L4.2 0" strokeWidth="2"></path></g></svg>
                  <div className="submenu">
                    <ul className="submenu-list">
                      <li className="submenu-item">
                        <a href="https://www.tabvar.org/about/news" className="submenu-link">News</a>
                      </li>
                      <li className="submenu-item">
                        <a href="https://www.tabvar.org/about/annualreports" className="submenu-link">Annual Reports</a>
                      </li>
                    </ul>
                  </div>
                </li>
                <li className="nav-item">
                  <a href="https://www.tabvar.org/topos" className="nav-link">TOPOS</a>
                </li>
              </ul>
            </nav>
          </div>
        </header>

        <MantineProvider
          theme={theme}
          defaultColorScheme="light"
        >
          <Notifications position="top-center" />
          <UserProvider user={user}>
            <EditorMenu />
            <Outlet />
          </UserProvider>
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
