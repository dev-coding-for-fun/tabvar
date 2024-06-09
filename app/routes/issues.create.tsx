import { Button, Container, FileInput, Group, LoadingOverlay, MultiSelect, Radio, Stack, Textarea, Title, rem } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { showNotification } from "@mantine/notifications";
import { ActionFunction, json } from "@remix-run/cloudflare";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { IconCheck, IconPhotoUp, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import RouteSearchBox, { SearchBoxRef } from "~/components/routeSearchBox";
import { issueTypes, subIssues, subIssuesByType } from "~/lib/constants";
import { getDB } from "~/lib/db";
import { uploadFileToR2 } from "~/lib/s3.server";

const R2_UPLOADS_BUCKET = 'tabvar-issues-uploads';
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
  const formData = await request.formData();
  const routeId = formData.get("route")?.toString() ?? '';
  const issueType = formData.get("issueType")?.toString() ?? '';
  const subIssueType = formData.get("subIssueType")?.toString() ?? '';
  const notes = formData.get("notes")?.toString() ?? '';
  const files = formData.getAll("photos") as File[];

  const errors = {
    routeId: validateRoute(routeId),
    issueType: validateIssueType(issueType),
  };
  if (Object.values(errors).some(Boolean)) {
    const errorMessage = (errors.routeId) ?? '' + errors.issueType ?? '';
    return json({ success: false, message: errorMessage }, { status: 400 });
  }

  const uploadedFiles = await Promise.all(files.map((file) =>
    uploadFileToR2(context, file, R2_UPLOADS_BUCKET)
  ));

  const db = getDB(context);
  const issueResult = await db
    .insertInto('issue')
    .values({
      route_id: Number(routeId),
      issue_type: issueType,
      sub_issue_type: subIssueType,
      description: notes,
      status: "submitted",
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const issueId = issueResult.id;

  if (!issueId) {
    return json({ success: false, message: 'Failed to submit issue' }, { status: 500 });
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
  return json({ success: true, message: 'Issue submitted successfully' });
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


  const actionData = useActionData<{ [key: string]: string }>();

  const isSubmitting = navigation.state === 'loading' || navigation.state === 'submitting';

  const isSubIssueDisabled = (subIssue: string) => {
    if (!selectedIssueType) return true;
    return !subIssuesByType[selectedIssueType].includes(subIssue);
  };

  const icon = <IconPhotoUp style={{ width: rem(18), height: rem(18) }} stroke={1.5} />;

  const boltOptions = Array.from({ length: boltCount ?? 10 }, (_, i) => ({ value: `${i + 1}`, label: `Bolt ${i + 1}` }));
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
      if (!subIssuesByType[selectedIssueType].includes(selectedSubIssue)) {
        setSelectedSubIssue(null);
      }
    }
  }, [selectedIssueType, selectedSubIssue]);

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        showNotification({
          title: 'Success',
          message: actionData.message,
          color: 'green',
          icon: <IconCheck />,
          autoClose: 3000,
        });
      } else {
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
    setBoltCount(selected.boltCount);
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
      <Form method="post" ref={formRef} encType="multipart/form-data">
        <LoadingOverlay visible={overlayVisible} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
        <Title order={1}>Submit an issue</Title>
        <RouteSearchBox
          label="Route"
          name="route"
          required={true}
          onChange={handleRouteChange}
          value={selectedRoute}
          ref={searchBoxRef}
        />
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
