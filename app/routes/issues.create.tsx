import { Button, Container, FileInput, Group, LoadingOverlay, MultiSelect, Radio, Space, Stack, Textarea, Title, rem } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { ActionFunction, data, redirect } from "@remix-run/cloudflare";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { IconPhotoUp, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import RouteDetailsModal from "~/components/routeDetailsModal";
import RouteSearchBox, { SearchBoxRef } from "~/components/routeSearchBox";
import { getAuthenticator } from "~/lib/auth.server";
import { SubIssueType, issueTypes, subIssues, subIssuesByType } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { uploadFileToR2 } from "~/lib/s3.server";

const MAX_FILE_SIZE = 5 * 1024 * 1024; //5 MB
type IssueType = keyof typeof subIssuesByType;

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
  const user = await getAuthenticator(context).isAuthenticated(request, {
    failureRedirect: "/login",
  });
  const formData = await request.formData();
  const routeParts = (formData.get("route")?.toString() ?? '').split(':');
  const routeId = (routeParts.length > 1 && routeParts[0] === 'route') ? routeParts[1] : '';
  const issueType = formData.get("issueType")?.toString() ?? '';
  const subIssueType = formData.get("subIssueType")?.toString() ?? '';
  const notes = formData.get("notes")?.toString() ?? '';
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
      status: "In Moderation",
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
  //return json({ success: true, message: 'Issue submitted successfully' });
  return redirect('/issues/?success=true');
}

export default function CreateIssue() {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType | null>(null);
  const [selectedSubIssue, setSelectedSubIssue] = useState<string | null>(null);
  const [selectedBolts, setSelectedBolts] = useState<string[]>([]);
  const [boltCount, setBoltCount] = useState<number | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const navigation = useNavigation();
  const [overlayVisible, { open, close }] = useDisclosure(false);
  const formRef = useRef<HTMLFormElement>(null);
  const searchBoxRef = useRef<SearchBoxRef | null>(null);
  const [routeModalOpened, setRouteModalOpened] = useState(false);


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
            </Stack>
          </Radio.Group>
          <Textarea
            name="notes"
            placeholder="Add any additional notes"
            autosize
            minRows={3}
          />
          <FileInput
            name="photos"
            value={selectedFiles}
            placeholder="Upload up to 3 photos, max 5MB"
            leftSection={icon}
            multiple
            clearable
            onChange={handleFileChange}
            error={fileError}
            accept="image/png,image/jpeg,image/gif,image/webp"
          />
          <Group p="md" mt="xl">
            <Button type="submit">Submit</Button>
          </Group>
        </Stack>
      </Form>
    </Container>
  )
}
