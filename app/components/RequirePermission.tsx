import { Alert, Container } from "@mantine/core";
import { useUser } from "../lib/hooks/useUser";

type AccessLevel = 'admin' | 'atLeastSuper' | 'atLeastMember';

interface RequirePermissionProps {
  children: React.ReactNode;
  access: AccessLevel;
  message?: string;
}

const ACCESS_LEVELS: Record<AccessLevel, string[]> = {
  'admin': ['admin'],
  'atLeastSuper': ['admin', 'super'],
  'atLeastMember': ['admin', 'super', 'member'],
};

export function RequirePermission({ 
  children, 
  access, 
  message = "You do not have permission to access this page." 
}: RequirePermissionProps) {
  const user = useUser();
  const allowedRoles = ACCESS_LEVELS[access];

  if (!user || !user.role || !allowedRoles.includes(user.role)) {
    return (
      <Container size="xl">
        <Alert title="Access Denied" color="red">
          {message}
        </Alert>
      </Container>
    );
  }

  return <>{children}</>;
} 