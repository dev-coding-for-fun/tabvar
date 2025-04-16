import { useState, useEffect, useRef } from "react";
import { Container, Paper, Title, Stack, Text, Group, Badge, ActionIcon, Button } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconUpload, IconX, IconFile, IconTrash } from "@tabler/icons-react";
import { ActionFunction, data } from "@remix-run/cloudflare";
import { Form, useFetcher } from "@remix-run/react";
import RouteSearchBox, { SearchBoxRef } from "~/components/routeSearchBox";
import type { TopoAttachment, Route } from "~/lib/models";
import { getDB } from "~/lib/db";
import { notifications } from "@mantine/notifications";
import { getAuthenticator } from "~/lib/auth.server";

interface ActionResponse {
  success: boolean;
  error?: string;
  route?: Pick<Route, 'id' | 'name' | 'sectorName' | 'cragName'>;
}

interface RouteInfo {
  id: string;
  details?: Pick<Route, 'id' | 'name' | 'sectorName' | 'cragName'>;
}

interface UploadedFile {
  file: File;
  attachment?: TopoAttachment;
  routes: RouteInfo[];
}

interface SaveResponse {
  success: boolean;
  error?: string;
}

export const action: ActionFunction = async ({ request, context }) => {
  const formData = await request.formData();
  const routeId = formData.get("routeId")?.toString();
  const fileIndex = formData.get("fileIndex")?.toString();

  const user = await getAuthenticator(context).isAuthenticated(request);
  if (!user || (user.role !== 'admin' && user.role !== 'member')) {
    return data({ success: false, error: "Unauthorized" }, { status: 403 });
  }

  if (!routeId || !fileIndex) {
    return data({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const db = getDB(context);
  const route = await db
    .selectFrom('route')
    .select(['id', 'name', 'sector_name', 'crag_name'])
    .where('id', '=', Number(routeId))
    .executeTakeFirst();

  if (!route) {
    return data({ success: false, error: "Route not found" }, { status: 404 });
  }

  return data({
    success: true,
    route: {
      id: route.id,
      name: route.name,
      sectorName: route.sector_name,
      cragName: route.crag_name
    }
  });
};

export default function ToposAttach() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const fetcher = useFetcher<ActionResponse>();
  const saveFetcher = useFetcher<SaveResponse>();
  const searchBoxRefs = useRef<(SearchBoxRef | null)[]>([]);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.route) {
      const { route } = fetcher.data;
      const fileIndex = Number(fetcher.formData?.get("fileIndex"));
      const routeId = fetcher.formData?.get("routeId")?.toString();

      setUploadedFiles(prev => prev.map((file, index) => 
        index === fileIndex 
          ? {
              ...file,
              routes: file.routes.map(r => 
                r.id === routeId ? { ...r, details: route } : r
              )
            }
          : file
      ));
    }
  }, [fetcher.data]);

  // Watch for save fetcher state changes
  useEffect(() => {
    if (saveFetcher.state === 'idle' && saveFetcher.data) {
      if (saveFetcher.data.error) {
        notifications.show({
          title: 'Error',
          message: saveFetcher.data.error,
          color: 'red'
        });
      } else if (saveFetcher.data.success) {
        notifications.show({
          title: 'Success',
          message: 'Files uploaded successfully',
          color: 'green'
        });
        // Reload after a short delay to allow notification to show
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const handleDrop = (files: File[]) => {
    const newFiles = files.map(file => ({
      file,
      attachment: undefined,
      routes: []
    }));
    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const handleRemoveRoute = (fileIndex: number, routeId: string) => {
    setUploadedFiles(prev => prev.map((file, index) => 
      index === fileIndex 
        ? {
            ...file,
            routes: file.routes.filter(r => r.id !== routeId)
          }
        : file
    ));
  };

  const handleRouteSelect = (fileIndex: number, value: { value: string | null }) => {
    if (!value.value) return;

    // Check if route is already added
    const file = uploadedFiles[fileIndex];
    if (file.routes.some(r => r.id === value.value)) {
      return; // Route already exists
    }

    // Add the route ID immediately
    setUploadedFiles(prev => prev.map((f, i) => 
      i === fileIndex 
        ? {
            ...f,
            routes: [...f.routes, { id: value.value! }]
          }
        : f
    ));

    // Fetch route details
    const formData = new FormData();
    formData.append("routeId", value.value);
    formData.append("fileIndex", fileIndex.toString());
    fetcher.submit(formData, { method: "post" });

    // Clear the search box
    if (searchBoxRefs.current[fileIndex]) {
      searchBoxRefs.current[fileIndex]?.reset();
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    // Filter files that have routes selected
    const filesToUpload = uploadedFiles.filter(file => file.routes.length > 0);
    
    if (filesToUpload.length === 0) {
      notifications.show({
        title: 'Warning',
        message: 'No files selected for upload',
        color: 'yellow'
      });
      setIsSaving(false);
      return;
    }

    try {
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append("_action", "upload");
        formData.append("file", file.file);
        file.routes.forEach(route => {
          formData.append("routeId", route.id);
        });
        
        saveFetcher.submit(formData, { 
          method: "post", 
          action: "/api/attachments",
          encType: "multipart/form-data"
        });
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'Failed to prepare files for upload',
        color: 'red'
      });
      setIsSaving(false);
    }
  };

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Group justify="space-between">
          <Title order={2}>Upload Topos</Title>
          {uploadedFiles.some(file => file.routes.length > 0) && (
            <Button 
              onClick={handleSave}
              loading={isSaving}
              disabled={isSaving}
            >
              Save All
            </Button>
          )}
        </Group>
        
        <Dropzone
          onDrop={handleDrop}
          accept={['image/*', 'application/pdf']}
          multiple
        >
          <Group justify="center" gap="xl" mih={220} style={{ pointerEvents: 'none' }}>
            <Dropzone.Accept>
              <IconUpload
                size={50}
                stroke={1.5}
                className="text-blue-500"
              />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX
                size={50}
                stroke={1.5}
                className="text-red-500"
              />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconFile size={50} stroke={1.5} />
            </Dropzone.Idle>

            <div>
              <Text size="xl" inline>
                Drag files here or click to select
              </Text>
              <Text size="sm" c="dimmed" inline mt={7}>
                Upload images or PDFs of topos
              </Text>
            </div>
          </Group>
        </Dropzone>

        {uploadedFiles.length > 0 && (
          <Stack gap="md">
            <Title order={3}>Uploaded Files</Title>
            {uploadedFiles.map((file, index) => (
              <Paper key={index} p="md" withBorder style={{ width: '100%', maxWidth: '800px'}}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text>{file.file.name}</Text>
                    <Text size="sm" c="dimmed">
                      {(file.file.size / 1024 / 1024).toFixed(2)} MB
                    </Text>
                  </Group>
                  
                  {file.routes.length > 0 && (
                    <Stack gap="xs">
                      <Text size="sm" fw={500}>Selected Routes:</Text>
                      <Stack gap="xs">
                        {file.routes.map(route => (
                          <Group key={route.id} gap="xs">
                            {route.details ? (
                              <>
                                <Text>{route.details.name}</Text>
                                <Group gap={4} wrap="nowrap">
                                  <Badge size="xs" color="sector-color">{route.details.sectorName}</Badge>
                                  <Badge size="xs" color="crag-color">{route.details.cragName}</Badge>
                                </Group>
                              </>
                            ) : (
                              <Text>Loading...</Text>
                            )}
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              onClick={() => handleRemoveRoute(index, route.id)}
                            >
                              <IconTrash size={12} />
                            </ActionIcon>
                          </Group>
                        ))}
                      </Stack>
                    </Stack>
                  )}
                  
                  <Form method="post">
                    <input type="hidden" name="fileIndex" value={index} />
                    <RouteSearchBox
                      label="Associate with Route"
                      name="routeId"
                      onChange={(value) => handleRouteSelect(index, value)}
                      value={null}
                      searchMode="routesOnly"
                      ref={el => searchBoxRefs.current[index] = el}
                    />
                  </Form>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
