import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';

function createClient(env) {
  const region = (env.AWS_REGION || 'us-east-1').trim();
  const accessKeyId = (env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY || '').trim();
  if (!accessKeyId || !secretAccessKey) return null;
  return new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: new FetchHttpHandler(),
  });
}

function formatErr(e, fallback) {
  if (e && typeof e === 'object') {
    const code = e.name || 'Error';
    const msg = e.message || fallback;
    const http = e.$metadata?.httpStatusCode;
    if (http) return `${fallback} (HTTP ${http}) [${code}]: ${msg}`;
    return `${fallback} [${code}]: ${msg}`;
  }
  return fallback;
}

const sesService = {
  isConfigured(env) {
    return Boolean(
      (env.AWS_ACCESS_KEY_ID || '').trim() &&
        (env.AWS_SECRET_ACCESS_KEY || '').trim(),
    );
  },

  async send(env, sendForm) {
    const client = createClient(env);
    if (!client) {
      return { error: { message: '未配置 AWS SES Secrets' } };
    }
    try {
      const out = await client.send(new SendEmailCommand(sendForm));
      return { data: { id: out.MessageId || `ses-${Date.now()}` } };
    } catch (e) {
      return { error: { message: formatErr(e, 'SES 发信失败') } };
    }
  },
};

export default sesService;
