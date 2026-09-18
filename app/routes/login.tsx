import {
  Title,
  Paper,
  Stack,
  Center,
  Text,
  Image,
  Button,
  Container,
  Divider,
  TextInput,
  PinInput,
  Alert,
  Group,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconArrowLeft, IconMail } from "@tabler/icons-react";
import {
  Form,
  useSearchParams,
  useActionData,
  useLoaderData,
  useNavigation,
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useEffect, useState } from "react";
import { privatePageMeta } from "~/lib/seo";
import {
  createUserSession,
  findOrCreateEmailUser,
  sendLoginEmail,
  verifyAuthCode,
} from "~/lib/auth.server";

export const meta: MetaFunction = () => privatePageMeta("Sign in");

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const errorParam = url.searchParams.get("error");
  let errorMessage: string | null = null;

  if (errorParam === "invalid_token" || errorParam === "missing_token") {
    errorMessage = "The login link is invalid or has expired. Please request a new code.";
  } else if (errorParam) {
    errorMessage = decodeURIComponent(errorParam);
  }

  return { error: errorMessage };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "send-code" || intent === "resend-code") {
    const email = String(formData.get("email") || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return data({ error: "Please enter a valid email address.", step: "email", email: "" }, { status: 400 });
    }

    const result = await sendLoginEmail(context, email);
    if (!result.success) {
      return data(
        {
          error: result.error || "Failed to send login code.",
          step: intent === "resend-code" ? "verify" : "email",
          email,
        },
        { status: 400 }
      );
    }

    return {
      success: true,
      step: "verify",
      email,
      resent: intent === "resend-code",
    };
  }

  if (intent === "verify-code") {
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const code = String(formData.get("code") || "").trim();

    if (!email || !code) {
      return data(
        { error: "Please enter the 6-digit code sent to your email.", step: "verify", email },
        { status: 400 }
      );
    }

    const verifyResult = await verifyAuthCode(context, email, code);
    if (!verifyResult.success) {
      return data(
        { error: verifyResult.error || "Invalid verification code.", step: "verify", email },
        { status: 400 }
      );
    }

    const cookieHeader = request.headers.get("Cookie");
    const cookies = cookieHeader
      ? Object.fromEntries(cookieHeader.split("; ").map((c) => c.split("=")))
      : {};
    let finalRedirectTo = "/topos";

    if (cookies.redirectTo) {
      try {
        let decodedPath = decodeURIComponent(cookies.redirectTo);
        if (!decodedPath.startsWith("/")) {
          decodedPath = `/${decodedPath}`;
        }
        finalRedirectTo = decodedPath;
      } catch {
        // fallback to /topos
      }
    }

    const user = await findOrCreateEmailUser(context, email);
    return createUserSession(request, context, user, finalRedirectTo);
  }

  return data({ error: "Invalid request.", step: "email", email: "" }, { status: 400 });
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");
  const actionData = useActionData<typeof action>();
  const loaderData = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  const [step, setStep] = useState<"email" | "verify">(
    actionData?.step === "verify" ? "verify" : "email"
  );
  const [emailInput, setEmailInput] = useState(actionData?.email || "");

  useEffect(() => {
    if (redirectTo) {
      document.cookie = `redirectTo=${encodeURIComponent(redirectTo)}; path=/`;
    }
  }, [redirectTo]);

  useEffect(() => {
    if (actionData?.step) {
      setStep(actionData.step as "email" | "verify");
      if (actionData.email) {
        setEmailInput(actionData.email);
      }
    }
  }, [actionData]);

  const activeEmail = actionData?.email || emailInput;
  const actionError = actionData && "error" in actionData ? actionData.error : null;
  const displayError = actionError || loaderData?.error;

  return (
    <Container size={420} my={40}>
      <Title ta="center" fw={900}>
        TABVAR Login
      </Title>
      <Text c="dimmed" size="sm" ta="center" mt={5}>
        Sign in to access route and issue management
      </Text>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        {displayError && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Unable to sign in"
            color="red"
            mb="lg"
          >
            {displayError}
          </Alert>
        )}

        {step === "verify" ? (
          <Stack>
            <Alert icon={<IconCheck size={16} />} color="teal" title="Check your email">
              We sent a 6-digit code and a login link to <strong>{activeEmail}</strong>.
            </Alert>

            <Form method="post">
              <input type="hidden" name="intent" value="verify-code" />
              <input type="hidden" name="email" value={activeEmail} />

              <Stack gap="md">
                <div>
                  <Text size="sm" fw={500} mb={6}>
                    Enter 6-digit code
                  </Text>
                  <Center>
                    <PinInput
                      length={6}
                      name="code"
                      type="number"
                      autoFocus
                      size="md"
                      disabled={isSubmitting}
                      oneTimeCode
                    />
                  </Center>
                </div>

                <Button type="submit" fullWidth loading={isSubmitting}>
                  Verify & Sign In
                </Button>
              </Stack>
            </Form>

            <Divider my="xs" />

            <Group justify="space-between">
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconArrowLeft size={14} />}
                onClick={() => setStep("email")}
                disabled={isSubmitting}
              >
                Use different email
              </Button>

              <Form method="post">
                <input type="hidden" name="intent" value="resend-code" />
                <input type="hidden" name="email" value={activeEmail} />
                <Button variant="subtle" size="xs" type="submit" loading={isSubmitting}>
                  Resend code
                </Button>
              </Form>
            </Group>
          </Stack>
        ) : (
          <Stack>
            <Form action="/auth/google" method="post">
              <Center>
                <Button
                  leftSection={<Image src="/google.png" alt="Google logo" width={30} height={30} />}
                  variant="default"
                  color="gray"
                  type="submit"
                  fullWidth
                  style={{ maxWidth: "240px" }}
                >
                  Continue with Google
                </Button>
              </Center>
            </Form>

            <Divider label="Or continue with email" labelPosition="center" my="md" />

            <Form method="post">
              <input type="hidden" name="intent" value="send-code" />
              <Stack gap="md">
                <TextInput
                  label="Email address"
                  placeholder="climber@example.com"
                  name="email"
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.currentTarget.value)}
                  leftSection={<IconMail size={16} />}
                  disabled={isSubmitting}
                />

                <Button type="submit" fullWidth loading={isSubmitting}>
                  Send Login Code
                </Button>
              </Stack>
            </Form>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}