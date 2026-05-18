import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL!;
const SES_REGION = process.env.SES_REGION ?? 'us-east-1';
const APP_URL = process.env.APP_URL ?? '';

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESClient({ region: SES_REGION });

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

async function collectGroupEmails(groupName: string): Promise<string[]> {
  const res = await cognito.send(
    new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: groupName,
      Limit: 60,
    }),
  );
  return (res.Users ?? [])
    .map((u) => u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '')
    .filter(Boolean);
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, string>
    | undefined;
  const requesterEmail = claims?.email ?? '';
  const requesterUsername = claims?.['cognito:username'] ?? '';

  if (!requesterEmail) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing requester identity' }),
    };
  }

  try {
    const [adminEmails, superAdminEmails] = await Promise.all([
      collectGroupEmails('Admin'),
      collectGroupEmails('SuperAdmin'),
    ]);
    const recipients = Array.from(new Set([...adminEmails, ...superAdminEmails])).filter(
      (e) => e && e !== requesterEmail,
    );

    if (recipients.length === 0) {
      console.warn('No admin recipients found for access request from', requesterEmail);
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, recipients: 0 }),
      };
    }

    const subject = `Facility Admin access request from ${requesterEmail}`;
    const body =
      `User ${requesterEmail} (username: ${requesterUsername}) has requested access ` +
      `to manage facilities in the Warming & Cooling Centers admin panel.\n\n` +
      (APP_URL ? `Review and approve in User Management:\n${APP_URL}/admin/users\n\n` : '') +
      `This is an automated message.`;

    await ses.send(
      new SendEmailCommand({
        Source: SES_FROM_EMAIL,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, recipients: recipients.length }),
    };
  } catch (err) {
    console.error('requestAccess error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
