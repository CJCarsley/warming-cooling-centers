import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from '../functions/postConfirmation/resource';

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
  groups: ['SuperAdmin', 'Admin', 'Approved', 'PendingApproval'],
  userAttributes: {
    'custom:facility_ids': {
      dataType: 'String',
      mutable: true,
    },
  },
  triggers: {
    postConfirmation,
  },
});
