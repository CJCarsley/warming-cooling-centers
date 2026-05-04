import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
  groups: ['SuperAdmin'],
  userAttributes: {
    'custom:facility_ids': {
      dataType: 'String',
      mutable: true,
    },
  },
});
