import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

export const handler: PostConfirmationTriggerHandler = async (event) => {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event;
  }

  try {
    const existing = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
      }),
    );
    const inAnyGroup = (existing.Groups ?? []).some((g) =>
      ['SuperAdmin', 'Admin', 'Approved'].includes(g.GroupName ?? ''),
    );
    if (inAnyGroup) return event;

    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: 'PendingApproval',
      }),
    );
  } catch (err) {
    console.error('postConfirmation add-to-group failed:', err);
  }

  return event;
};
