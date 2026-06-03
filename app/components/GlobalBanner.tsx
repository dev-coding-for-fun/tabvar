import React from 'react';
import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import {
  DISCLAIMER_TITLE,
  DisclaimerAcknowledgementForm,
  DisclaimerMessage,
  useDisclaimerAcknowledgement,
} from './DisclaimerAcknowledgement';

const GlobalBanner: React.FC = () => {
  const { isAcknowledged, isReady } = useDisclaimerAcknowledgement();

  if (!isReady || isAcknowledged) {
    return null;
  }

  const icon = <IconAlertTriangle />;

  return (
    <div data-nosnippet>
      <Alert
        title={DISCLAIMER_TITLE}
        color="red"
        icon={icon}
        radius="md"
        style={{ margin: '1rem' }}
        mt="md" // Added some margin-top for spacing from header
      >
        <DisclaimerMessage />
        <DisclaimerAcknowledgementForm />
      </Alert>
    </div>
  );
};

export default GlobalBanner; 