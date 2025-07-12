import { Button, Container, FileInput, Group, LoadingOverlay, MultiSelect, Radio, Space, Stack, Textarea, Title, rem } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { ActionFunction, LoaderFunction, data, redirect } from "@remix-run/cloudflare";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { IconPhotoUp, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import RouteSearchBox, { SearchBoxRef } from "~/components/routeSearchBox";
import { requireUser } from "~/lib/auth.server";
import { SubIssueType, issueTypes, subIssues, subIssuesByType } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { RouteSearchResults } from "~/lib/models";
import { uploadFileToR2 } from "~/lib/s3.server";
import { useFetcher } from "@remix-run/react";

const MAX_FILE_SIZE = 5 * 1024 * 1024; //5 MB
type IssueType = keyof typeof subIssuesByType;

export const loader: LoaderFunction = async ({ request, context }) => {
  await requireUser(request, context);
  const url = new URL(request.url);
  const routeId = url.searchParams.get('routeId');

  if (!routeId) {
    return data({ initialRoute: null });
  }

  const db = getDB(context);
  const route = await db
    .selectFrom('route')
    .innerJoin('sector', 'route.sector_id', 'sector.id')
    .innerJoin('crag', 'sector.crag_id', 'crag.id')
    .where('route.id', '=', parseInt(routeId))
    .select([
      'route.id as routeId',
      'route.sector_id as sectorId',
      'route.crag_id as cragId',
      'route.name as routeName',
      'route.alt_names as routeAltNames',
      'sector.name as sectorName',
      'crag.name as cragName',
      'route.grade_yds as gradeYds',
      'route.bolt_count as boltCount',
      'route.pitch_count as pitchCount'
    ])
    .executeTakeFirst();

  if (!route) {
    return data({ initialRoute: null });
  }

  const routeResult: RouteSearchResults = {
    routeId: route.routeId,
    sectorId: route.sectorId,
    cragId: route.cragId,
    routeName: route.routeName,
    routeAltNames: route.routeAltNames,
    type: 'route',
    sectorName: route.sectorName,
    cragName: route.cragName,
    gradeYds: route.gradeYds,
    boltCount: route.boltCount?.toString(),
    pitchCount: route.pitchCount?.toString()
  };

  return data({ initialRoute: routeResult });
};

const validateRoute = (routeId: string) => {
  if (!routeId) {
    return "Route selection is required";
  }
  else if (Number(routeId) <= 0) {
    return "Invalid Route. Something went wrong";
  }
}

const validateIssueType = (issueType: string) => {
  if (!issueTypes.some(type => type.value === issueType)) {
    return "Issue type missing, please select one";
  }
}

export const action: ActionFunction = async ({ request, context }) => {
  const user = await requireUser(request, context);
  const formData = await request.formData();
  const routeParts = (formData.get("route")?.toString() ?? '').split(':');
  const routeId = (routeParts.length > 1 && routeParts[0] === 'route') ? routeParts[1] : '';
  const issueType = formData.get("issueType")?.toString() ?? '';
  const subIssueType = formData.get("subIssueType")?.toString() ?? '';
  const notes = formData.get("notes")?.toString() ?? '';
  const boltNumbers = formData.get("boltNumbers")?.toString() ?? '';
  const files = (formData.getAll("photos") as File[]).filter(file => file && file.size > 0);
  const errors = {
    routeId: validateRoute(routeId),
    issueType: validateIssueType(issueType),
  };
  if (Object.values(errors).some(Boolean)) {
    const errorMessage = (errors.routeId) ?? '' + errors.issueType ?? '';
    return data({ success: false, message: errorMessage }, { status: 400 });
  }

  const env = context.cloudflare.env as unknown as Env;
  const uploadedFiles = await Promise.all(files.map((file) =>
    uploadFileToR2(context, file, env.ISSUES_BUCKET_NAME, env.ISSUES_BUCKET_DOMAIN)
  ));

  const db = getDB(context);
  const issueResult = await db
    .insertInto('issue')
    .values({
      route_id: Number(routeId),
      issue_type: issueType,
      sub_issue_type: subIssueType,
      description: notes,
      bolts_affected: boltNumbers || null,
      status: "In Moderation",
      reported_by_uid: user.uid,
      reported_by: user.displayName,
      last_modified: new Date().toISOString(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const issueId = issueResult.id;

  if (!issueId) {
    return data({ success: false, message: 'Failed to submit issue' }, { status: 500 });
  }

  await Promise.all(uploadedFiles.map(uploadedFile =>
    db
      .insertInto('issue_attachment')
      .values({
        issue_id: issueId,
        name: uploadedFile.name,
        type: uploadedFile.type,
        url: uploadedFile.url,
      })
      .execute()
  ));
  return redirect('/issues/?success=true');
}

export default function CreateIssue() {
  const { initialRoute } = useLoaderData<{ initialRoute: RouteSearchResults | null }>();

  const getInitialRouteValue = () => {
    if (!initialRoute) return null;
    return `route:${initialRoute.routeId}:${initialRoute.cragId}`;
  }

  const [selectedRoute, setSelectedRoute] = useState<string | null>(getInitialRouteValue());
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType | null>(null);
  const [selectedSubIssue, setSelectedSubIssue] = useState<string | null>(null);
  const [selectedBolts, setSelectedBolts] = useState<string[]>([]);
  const [boltCount, setBoltCount] = useState<number | null>(initialRoute?.boltCount ? Number(initialRoute.boltCount) : null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const navigation = useNavigation();
  const [overlayVisible, { open, close }] = useDisclosure(false);
  const formRef = useRef<HTMLFormElement>(null);
  const searchBoxRef = useRef<SearchBoxRef | null>(null);
  const [routeModalOpened, setRouteModalOpened] = useState(false);
  const [searchParams] = useSearchParams();

  const actionData = useActionData<{ [key: string]: string }>();

  const isSubmitting = navigation.state === 'loading' || navigation.state === 'submitting';

  const isSubIssueDisabled = (subIssue: string) => {
    if (!selectedIssueType) return true;
    return !subIssuesByType[selectedIssueType].includes(subIssue as SubIssueType);
  };

  const icon = <IconPhotoUp style={{ width: rem(18), height: rem(18) }} stroke={1.5} />;

  const boltOptions = Array.from({ length: boltCount ?? 20 }, (_, i) => ({ value: `${i + 1}`, label: `Bolt ${i + 1}` }));
  boltOptions.push({ value: "Anchor", label: "Anchor" });

  useEffect(() => {
    if (isSubmitting) {
      open();
      formRef.current?.reset();
      if (searchBoxRef.current) searchBoxRef.current.reset();
      setSelectedSubIssue(null);
      setSelectedIssueType(null);
      setSelectedRoute(null);
      setBoltCount(null);
      setSelectedFiles([]);
      setSelectedBolts([]);
    }
    else {
      close();
    }
  }, [isSubmitting, open, close]);

  useEffect(() => {
    if (selectedIssueType && selectedSubIssue) {
      if (!subIssuesByType[selectedIssueType].includes(selectedSubIssue as SubIssueType)) {
        setSelectedSubIssue(null);
      }
    }
  }, [selectedIssueType, selectedSubIssue]);

  useEffect(() => {
    if (actionData) {
      if (!actionData.success) {
        showNotification({
          title: 'Error',
          message: actionData.message,
          color: 'red',
          icon: <IconX />,
          autoClose: 3000,
        });
      }
    }
  }, [actionData]);

  const handleRouteChange = (selected: { value: string | null; boltCount: number | null }) => {
    setSelectedRoute(selected.value);
    setBoltCount((selected.boltCount) ? selected.boltCount : 20);
  }

  const handleFileChange = (files: File[]) => {
    const validFiles = files.filter(file => {
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`File ${file.name} is too large. Maximum size is 5 MB.`);
        return false;
      }
      return true;
    });
    if (files.length > 3) {
      if (fileError != null) setFileError("Too many files and one or more is too large. Choose a maximum of 3 files under 5MB each");
      else setFileError(`Too many images selected. Choose a maximum of 3`);
    }
    else if (validFiles.length === files.length) {
      setFileError(null);
    }
    setSelectedFiles(validFiles);
  };

  return (
    <Container size="md" p="md">
      <Stack>
        <Title order={1}>Submit an issue</Title>
        <Link to={`/issues/`}>👁‍🗨 View Issues</Link>
      </Stack>

      <Form method="post" ref={formRef} encType="multipart/form-data">
        <LoadingOverlay visible={overlayVisible} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
        <RouteSearchBox
          label="Route"
          name="route"
          required={true}
          onChange={handleRouteChange}
          value={selectedRoute}
          ref={searchBoxRef}
          initialItems={initialRoute ? [initialRoute] : []}
        />
        <Space h="sm" />
        <Stack>
          <Radio.Group
            label="Select what is affected by the issue"
            name="issueType"
            description="for multi-pitch routes, detail affected pitch(es) in the notes"
            required={true}
            value={selectedIssueType ?? ''}
            onChange={(value: string) => setSelectedIssueType(value as IssueType)}
          ><Group mt="xs">
              {issueTypes.map((issue) => (
                <Radio key={issue.value} value={issue.value} label={issue.label} />
              ))}
            </Group></Radio.Group>
          {selectedIssueType === 'Bolts' && (
            <MultiSelect
              name="boltNumbers"
              data={boltOptions}
              placeholder="Select bolt numbers"
              value={selectedBolts}
              onChange={setSelectedBolts}
            />
          )}
          <Radio.Group
            label="Select the nature or type of the issue"
            name="subIssueType"
            value={selectedSubIssue}
            onChange={setSelectedSubIssue}
          ><Stack>
              {subIssues.map((subIssue) => (
                <Radio
                  key={subIssue.value}
                  value={subIssue.value}
                  label={subIssue.label}
                  disabled={isSubIssueDisabled(subIssue.value)}
                />
              ))}
            </Stack></Radio.Group>
          <Textarea
            label="Notes"
            name="notes"
            placeholder="Add any additional details about the issue"
            autosize
            minRows={3}
          />
          <FileInput
            label="Photos"
            placeholder="Upload up to 3 photos"
            accept="image/*"
            multiple
            leftSection={icon}
            value={selectedFiles}
            onChange={handleFileChange}
            error={fileError}
            name="photos"
          />
          <Group justify="flex-end" mt="md">
            <Button type="submit" loading={isSubmitting}>Submit Issue</Button>
          </Group>
        </Stack>
      </Form>
    </Container>
  );
}
