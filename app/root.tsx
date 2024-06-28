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

import { ColorSchemeScript, DEFAULT_THEME, MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from "@mantine/notifications";

const theme = createTheme({
  primaryColor: 'blue',
  colors: {
    'route-color': DEFAULT_THEME.colors.blue,
    'sector-color': DEFAULT_THEME.colors.grape,
    'crag-color': DEFAULT_THEME.colors.violet,
    'status-in-moderation': DEFAULT_THEME.colors.pink,
    'status-reported': DEFAULT_THEME.colors.indigo,
    'status-viewed' : DEFAULT_THEME.colors.indigo,
    'status-completed' : DEFAULT_THEME.colors.green,
  }
})

export function Layout({ children }: { children: React.ReactNode }) {
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
        <MantineProvider 
          theme={theme}
          defaultColorScheme="light"
        >
          <Notifications position="top-center"/>
          {children}
        </MantineProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
