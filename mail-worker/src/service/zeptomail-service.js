const ZEPTOMAIL_API = 'https://api.zeptomail.com/v1.1/email';

function formatErr(e, fallback) {
  if (e && typeof e === 'object') {
    const msg = e.message || fallback;
    return `${fallback}: ${msg}`;
  }
  return fallback;
}

async function toZeptomailAttachments(attachments = []) {
  const result = [];
  for (const attachment of attachments) {
    const content = await toBase64(attachment);
    if (!content) continue;
    result.push({
      name: attachment.filename || attachment.name || 'attachment',
      content,
      mime_type:
        attachment.mimeType || attachment.contentType || attachment.type || 'application/octet-stream',
    });
  }
  return result;
}

async function toBase64(attachment) {
  let content = attachment.content;
  if (!content) return null;

  if (typeof content === 'string') {
    if (content.startsWith('data:')) {
      content = content.split(',')[1] || content;
    }
    return content.replace(/\s+/g, '');
  }

  if (content instanceof ArrayBuffer) {
    content = new Uint8Array(content);
  }
  if (content instanceof Uint8Array) {
    let binary = '';
    for (let i = 0; i < content.length; i += 0x8000) {
      binary += String.fromCharCode(...content.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  return null;
}

const zeptomailService = {
  isConfigured(env) {
    return Boolean((env.ZEPTOMAIL_TOKEN || '').trim());
  },

  resolveProvider(env) {
    const provider = (env.SEND_PROVIDER || '').trim().toLowerCase();
    if (provider === 'zeptomail') return 'zeptomail';
    if (provider === 'ses') return 'ses';
    if (this.isConfigured(env)) return 'zeptomail';
    return null;
  },

  async send(env, params) {
    const token = (env.ZEPTOMAIL_TOKEN || '').trim();
    if (!token) {
      return { error: { message: '未配置 ZEPTOMAIL_TOKEN' } };
    }

    const fromAddress = (params.accountEmail || env.ZEPTOMAIL_FROM || '').trim();
    if (!fromAddress) {
      return { error: { message: '缺少发件人地址' } };
    }

    const body = {
      from: {
        address: fromAddress,
        name: params.name || fromAddress.split('@')[0],
      },
      to: params.receiveEmail.map((address) => ({
        email_address: {
          address,
          name: address.split('@')[0] || address,
        },
      })),
      subject: params.subject || '',
    };

    if (params.html) body.htmlbody = params.html;
    if (params.text) body.textbody = params.text;
    if (!params.html && !params.text) body.textbody = '';

    const attachments = await toZeptomailAttachments(params.attachments || []);
    if (attachments.length > 0) body.attachments = attachments;

    if (params.sendType === 'reply' && params.messageId) {
      body.mime_headers = {
        'In-Reply-To': params.messageId,
        References: params.messageId,
      };
    }

    try {
      const res = await fetch(ZEPTOMAIL_API, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${token}`,
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        const detail =
          data?.error?.details?.[0]?.message ||
          data?.error?.message ||
          data?.message ||
          text.slice(0, 200) ||
          `HTTP ${res.status}`;
        return { error: { message: `ZeptoMail 发信失败: ${detail}` } };
      }

      const messageId =
        data?.data?.[0]?.message_id ||
        data?.data?.message_id ||
        data?.request_id ||
        `zeptomail-${Date.now()}`;

      return { data: { id: messageId } };
    } catch (e) {
      return { error: { message: formatErr(e, 'ZeptoMail 发信失败') } };
    }
  },
};

export default zeptomailService;
