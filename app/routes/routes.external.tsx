import { Button, Code, Container, Group, Loader, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { ActionFunction, LoaderFunction, data } from "@remix-run/cloudflare";
import { useFetcher } from "@remix-run/react";
import { User } from "~/lib/models";
import { useEffect, useState } from "react";
import { requireUser } from "~/lib/auth.server";
import { PERMISSION_ERROR } from "~/lib/constants";

type OpenBetaResponse = {
    data?: {
        areas: Array<{
            area_name: string;
            children: Array<{
                area_name: string;
                metadata: {
                    lat: number;
                    lng: number;
                };
                climbs: Array<{
                    name: string;
                    type: {
                        sport: boolean;
                        trad: boolean;
                        boulder: boolean;
                    };
                    grades: {
                        yds: string;
                    };
                    description: string;
                }>;
            }>;
        }>;
    };
    error?: string;
};

export const action: ActionFunction = async ({ request, context }) => {
  const user = await requireUser(request, context);
  if (!user || (user.role !== 'admin' && user.role !== 'super')) {
    return data({ error: 'Unauthorized' }, { status: 403 });
  }
    const query = `
query getMyAreas {
  banff: areas(
    filter: {area_name: {match: "Banff National Park", exactMatch: true}}
  ) {
    children {
      area_name
      children {
        area_name
        metadata {
          lat
          lng
        }
        children {
          area_name
          metadata {
            lat
            lng
          }
        }
      }
      metadata {
        lat
        lng
      }
    }
    metadata {
      lat
      lng
    }
  }
  bowValley: areas(filter: {area_name: {match: "Bow Valley", exactMatch: true}}) {
    children {
      area_name
      children {
        area_name
        metadata {
          lat
          lng
        }
        children {
          area_name
          metadata {
            lat
            lng
          }
        }
      }
      metadata {
        lat
        lng
      }
    }
    metadata {
      lat
      lng
    }
  }
  whiteBuddha: areas(
    filter: {area_name: {match: "White Buddha", exactMatch: true}}
  ) {
    children {
      area_name
      children {
        area_name
        metadata {
          lat
          lng
        }
        children {
          area_name
          metadata {
            lat
            lng
          }
        }
      }
      metadata {
        lat
        lng
      }
    }
    metadata {
      lat
      lng
    }
  }
}

`;

    try {
        const response = await fetch('https://api.openbeta.io', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        return data;
    } catch (error) {
        return data({ error: (error as Error).message }, { status: 500 });
    }
};

export const loader: LoaderFunction = async ({ request, context }) => {
    const user: User = await requireUser(request, context);
    if (user.role !== 'admin') {
        return data({ error: PERMISSION_ERROR }, { status: 403 });
    }
    return data({});
}

export default function ExternalRoutes() {
    const fetcher = useFetcher<OpenBetaResponse>();
    const [result, setResult] = useState<string>("");

    useEffect(() => {
        if (fetcher.data) {
            setResult(JSON.stringify(fetcher.data, null, 2));
        }
    }, [fetcher.data]);

    return <Container>
        <Title mb="lg">External Route Tools</Title>

        <Stack gap="md">
            <Group>
                <Button
                    onClick={() => fetcher.submit({}, { method: "post" })}
                    loading={fetcher.state === "submitting"}
                >
                    Fetch from OpenBeta
                </Button>
            </Group>

            {fetcher.data?.error && (
                <Text color="red">{fetcher.data.error}</Text>
            )}

            <Textarea
                value={result}
                minRows={25}
                autosize
                readOnly
                styles={{ input: { fontFamily: 'monospace' } }}
            />
        </Stack>
    </Container>;
}