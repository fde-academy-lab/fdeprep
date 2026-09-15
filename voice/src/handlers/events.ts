/**
 * The slices of the Lambda event shapes these handlers read.
 *
 * Declared here rather than pulled from @types/aws-lambda, because four
 * handlers read nine fields between them and a type package would be a
 * dependency carried for that. Each shape is the one AWS documents for
 * WebSocket APIs; the fields this file does not name are still delivered and
 * simply go unread.
 */

export type WebSocketRequestContext = {
  routeKey: string;
  connectionId: string;
  domainName: string;
  stage: string;
  /**
   * Documented on the $connect event. I could not confirm from the AWS
   * documentation that it is also present on $default, so every read of it is
   * guarded and the ceiling it feeds is treated as best effort. API Gateway's
   * own 7,200 second connection duration is the backstop either way.
   */
  connectedAt?: number;
};

export type WebSocketEvent = {
  requestContext: WebSocketRequestContext;
  body?: string;
  isBase64Encoded?: boolean;
};

export type AuthorizerEvent = {
  type: "REQUEST";
  methodArn: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext: { connectionId: string };
};

export type AuthorizerResult = {
  principalId: string;
  policyDocument: {
    Version: "2012-10-17";
    Statement: { Action: string; Effect: "Allow" | "Deny"; Resource: string }[];
  };
  context?: Record<string, string | number | boolean>;
};

export type SqsEvent = {
  Records: { messageId: string; body: string; attributes?: Record<string, string> }[];
};
