import React, { useState, useEffect } from 'react';
import { useUser } from '~/lib/hooks/useUser';
import { Alert, Button, Text, Space } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useFetcher } from '@remix-run/react';

const GlobalBanner: React.FC = () => {
  const user = useUser();
  const fetcher = useFetcher<{ success?: boolean; disclaimerAckDate?: string; error?: string }>();
  const [isLocallyDismissed, setIsLocallyDismissed] = useState(false);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.disclaimerAckDate) {
      setIsLocallyDismissed(true);
    }
  }, [fetcher.data]);

  const hasAcknowledgedOnline = !!user?.disclaimerAckDate;

  if (user === undefined || (user && (hasAcknowledgedOnline || isLocallyDismissed))) {
    return null;
  }
  

  const handleDismiss = () => {
    fetcher.submit(
      {},
      { method: 'post', action: '/action/acknowledge-disclaimer' }
    );
    // Optimistically hide, actual persistence is via DB
    setIsLocallyDismissed(true);
  };

  const icon = <IconAlertTriangle />;
  const warningMessage = "Rock climbing is a potentially dangerous sport, and anyone who does not fully recognize this fact should not use any of the information provided herein. The information only provides the location and approximate path followed by the various climbs and offers no advice, expressed or implied, as to how they may be safely ascended or descended. The contents of the information provided are subject to errors and omissions and to changes that may take place over time. Anyone in doubt of their ability to safely climb and descend from any of these routes is strongly advised to not go on the route or to use the services of a registered mountain guide.";

  return (
    <Alert
      title="Important Safety Notice"
      color="red"
      icon={icon}
      radius="md"
      style={{ margin: '1rem' }}
      mt="md" // Added some margin-top for spacing from header
    >
      <Text>{warningMessage}</Text>
      {user && (
        <>
          <Space h="md" />
          <Button 
            onClick={handleDismiss} 
            variant="outline" 
            color="red" 
            size="xs"
            loading={fetcher.state === 'submitting' || fetcher.state === 'loading'}
          >
            Acknowledge & Hide
          </Button>
        </>
      )}
      {fetcher.data?.error && (
        <Text c="red" size="sm" mt="xs">Error: {fetcher.data.error}</Text>
      )}
    </Alert>
  );
};

export default GlobalBanner; 