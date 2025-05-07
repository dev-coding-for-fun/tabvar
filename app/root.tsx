import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "@remix-run/react";
import '@mantine/core/styles.layer.css';
import 'mantine-datatable/styles.layer.css';
import '@mantine/notifications/styles.css';
import '@mantine/tiptap/styles.css';
import './styles/custom.css';
import './styles/header.css';
import {
  ColorSchemeScript,
  DEFAULT_THEME,
  MantineProvider,
  createTheme,
  Burger,
  Drawer,
  Stack,
  NavLink,
  rem,
  Box,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Notifications } from "@mantine/notifications";
import { LoaderFunction } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import { getAuthenticator } from "~/lib/auth.server";
import type { User } from "~/lib/models";
import { UserProvider } from "./lib/hooks/useUser";
import { EditorMenu } from "./components/EditorMenu";
import RouteSearchBox from "./components/routeSearchBox";
import { useCallback, useRef } from "react";
import { MapboxProvider } from "./contexts/MapboxContext";
import GlobalBanner from "./components/GlobalBanner";

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
  headings: {
    fontFamily: "'Lato', sans-serif",
    sizes: {
      h3: { fontSize: 'var(--mantine-font-size-md)' }
    }
  }
})

export const loader: LoaderFunction = async ({ request, context }) => {
  const user = await getAuthenticator(context).isAuthenticated(request);
  const mapboxAccessToken = context.cloudflare.env.MAPBOX_ACCESS_TOKEN;
  const mapboxStyleUrl = context.cloudflare.env.MAPBOX_STYLE_URL;

  if (!mapboxAccessToken || !mapboxStyleUrl) {
    console.warn("Mapbox configuration missing in environment variables.");
  }

  return {
    user,
    mapboxAccessToken: mapboxAccessToken || undefined,
    mapboxStyleUrl: mapboxStyleUrl || undefined
  };
};

interface RootLoaderData {
  user: User | null;
  mapboxAccessToken: string | undefined;
  mapboxStyleUrl: string | undefined;
}

export default function App() {
  const { user, mapboxAccessToken, mapboxStyleUrl } = useLoaderData<RootLoaderData>();
  const navigate = useNavigate();
  const searchBoxRef = useRef<{ reset: () => void }>(null);
  const [drawerOpened, { toggle: toggleDrawer, close: closeDrawer }] = useDisclosure(false);
  const isMobile = useMediaQuery('(max-width: 1100px)', true, { getInitialValueInEffect: false });

  const handleSearchSelect = useCallback((selected: { value: string | null; boltCount: number | null }) => {
    if (selected.value) {
      const parts = selected.value.split(':');
      const type = parts[0];
      const id = parts[1];
      const cragPath = parts[2];

      if (type === 'route') {
        navigate(`/topos/${cragPath}#route-${id}`);
      } else if (type === 'sector') {
        navigate(`/topos/${cragPath}#sector-${id}`);
      } else if (type === 'crag') {
        navigate(`/topos/${cragPath}`);
      }

      searchBoxRef.current?.reset();
    }
  }, [navigate]);

  const handleDrawerNavigate = (path: string) => {
    closeDrawer();
    navigate(path);
  };

  const handleDrawerExternalLink = (url: string) => {
    closeDrawer();
    window.location.href = url;
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <ColorSchemeScript />
      </head>
      <body style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', margin: 0 }}>
        <MantineProvider
          theme={theme}
          defaultColorScheme="light"
        >
          <Notifications position="top-center" />
          <UserProvider user={user}>
            <MapboxProvider accessToken={mapboxAccessToken} styleUrl={mapboxStyleUrl}>
              <Box style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                <header>
                  <Drawer opened={drawerOpened} onClose={closeDrawer} title="Navigation" padding="md" size="md">
                    <Stack>
                      <NavLink label="Home" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/home')} />
                      <NavLink label="Donate" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/donatenew')} />
                      <NavLink label="Routebuilders Section" defaultOpened>
                        <NavLink label="Submission and Funding" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/routebuilders/submission-and-funding')} />
                        <NavLink label="Bulk Hardware Orders" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/routebuilders/bulk-hardware-orders')} />
                      </NavLink>
                      <NavLink label="Supporters" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/supporters')} />
                      <NavLink label="About" defaultOpened>
                        <NavLink label="News" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/about/news')} />
                        <NavLink label="Annual Reports" onClick={() => handleDrawerExternalLink('https://www.tabvar.org/about/annualreports')} />
                      </NavLink>
                      <NavLink label="TOPOS" onClick={() => handleDrawerNavigate('/topos')} />
                    </Stack>
                  </Drawer>

                  <div className="header-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {isMobile ? (
                      <Burger
                        opened={drawerOpened}
                        onClick={toggleDrawer}
                        aria-label="Toggle navigation"
                        size="sm"
                      />
                    ) : (
                      <div style={{ width: rem(28), height: rem(28) }}></div>
                    )}

                    <a href="https://www.tabvar.org/home" aria-hidden="false">
                      <img src="../tabvar.png" alt="TABVAR" className="logo" />
                    </a>

                    <div style={{ flex: '1', maxWidth: '600px', margin: '0 auto' }}>
                      <RouteSearchBox
                        ref={searchBoxRef}
                        label=""
                        name="globalSearch"
                        onChange={handleSearchSelect}
                        value={null}
                        searchMode="allObjects"
                      />
                    </div>

                    {!isMobile && (
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
                            <a href="/topos" className="nav-link">TOPOS</a>
                          </li>
                        </ul>
                      </nav>
                    )}
                  </div>
                </header>
                <GlobalBanner />
                <Box style={{ flexGrow: 1 }}>
                  <EditorMenu />
                  <Outlet />
                </Box>

                <footer style={{ textAlign: 'center', marginTop: 'auto', padding: '1rem 0', borderTop: '1px solid var(--mantine-color-gray-3)', fontSize: 'var(--mantine-font-size-sm)' }}>
                  <a href="https://github.com/dev-coding-for-fun/tabvar/issues" target="_blank" rel="noopener noreferrer" style={{ marginRight: '0.5rem' }}>report a bug</a>
                  |
                  <a href="https://github.com/dev-coding-for-fun/tabvar/discussions/categories/ideas" target="_blank" rel="noopener noreferrer" style={{ marginLeft: '0.5rem' }}>suggest a feature</a>
                </footer>
              </Box>
            </MapboxProvider>
          </UserProvider>
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
