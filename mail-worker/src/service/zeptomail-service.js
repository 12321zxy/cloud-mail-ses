const DEFAULT_ZEPTOMAIL_API = 'https://api.zeptomail.com/v1.1/email';

function resolveApiUrl(env) {
  const custom = (env.ZEPTOMAIL_API || '').trim();
  if (custom) return custom.replace(/\/$/, '');
  return DEFAULT_ZEPTOMAIL_API;
}

function normalizeToken(raw) {
  let token = (raw || '').trim();
  if (!token) return '';
  const lower = token.toLowerCase();
  if (lower.startsWith('zoho-enczapikey ')) {
    token = token.slice('zoho-enczapikey '.length).trim();
  }
  return token;
}

function parseZeptomailError(data, text, status) {
  const err = data?.error && typeof data.error === 'object' ? data.error : {};
  const parts = [];

  if (err.code) parts.push(`code=${err.code}`);
  if (err.message) parts.push(String(err.message).trim());

  if (Array.isArray(err.details)) {
    err.details.forEach((d) => {
      if (!d || typeof d !== 'object') return;
      const seg = [d.code, d.target, d.message].filter(Boolean).join(' ');
      if (seg) parts.push(seg);
    });
  }

  if (data?.message && typeof data.message === 'string' && !err.message) {
    parts.push(data.message.trim());
  }
  if (err.request_id) parts.push(`request_id=${err.request_id}`);
  if (data?.request_id && !err.request_id) parts.push(`request_id=${data.request_id}`);

  const joined = parts.filter(Boolean).join(' | ');
  if (joined) return joined;

  const raw = (text || '').trim();
  if (raw) return raw.slice(0, 400);
  return `HTTP ${status}`;
}

function formatErr(e, fallback) {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (msg) return `${fallback}: ${msg}`;
  return fallback;
}

function emailDomain(addr) {
  const at = (addr || '').lastIndexOf('@');
  if (at < 0) return '';
  return addr.slice(at + 1).trim().toLowerCase();
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
    return Boolean(normalizeToken(env.ZEPTOMAIL_TOKEN));
  },

  resolveProvider(env) {
    const provider = (env.SEND_PROVIDER || '').trim().toLowerCase();
    if (provider === 'zeptomail') return 'zeptomail';
    if (provider === 'ses') return 'ses';
    if (this.isConfigured(env)) return 'zeptomail';
    return null;
  },

  async send(env, params) {
    const token = normalizeToken(env.ZEPTOMAIL_TOKEN);
    if (!token) {
      return { error: { message: '未配置 ZEPTOMAIL_TOKEN（需 Mail Agent Send Mail Token，非 OAuth Token）' } };
    }

    const accountEmail = (params.accountEmail || '').trim();
    const configuredFrom = (env.ZEPTOMAIL_FROM || '').trim();
    let fromAddress = accountEmail || configuredFrom;
    if (!fromAddress) {
      return { error: { message: '缺少发件人地址（邮箱账户或 ZEPTOMAIL_FROM）' } };
    }

    const verifiedDomain = emailDomain(configuredFrom);
    const accountDomain = emailDomain(accountEmail);
    let replyToAccount = null;

    // 发件域名须已在 Mail Agent 验证；跨域时改用 ZEPTOMAIL_FROM 并设置 reply_to
    if (configuredFrom && accountEmail && verifiedDomain && accountDomain && accountDomain !== verifiedDomain) {
      fromAddress = configuredFrom;
      replyToAccount = accountEmail;
    }

    const body = {
      from: {
        address: fromAddress,
        name: params.name || fromAddress.split('@')[0],
      },
      to: (params.receiveEmail || []).map((address) => ({
        email_address: {
          address,
          name: address.split('@')[0] || address,
        },
      })),
      subject: params.subject || '(无主题)',
    };

    if (!body.to.length) {
      return { error: { message: '缺少收件人地址' } };
    }

    // ZeptoMail 要求 htmlbody 或 textbody 至少一项且非空
    const html = (params.html || '').trim();
    const text = (params.text || '').trim();
    if (html) {
      body.htmlbody = params.html;
    } else if (text) {
      body.textbody = params.text;
    } else {
      body.htmlbody = '<div></div>';
    }

    const attachments = await toZeptomailAttachments(params.attachments || []);
    if (attachments.length > 0) body.attachments = attachments;

    if (replyToAccount) {
      body.reply_to = [{ address: replyToAccount, name: params.name || replyToAccount.split('@')[0] }];
    }

    if (params.sendType === 'reply' && params.messageId) {
      body.mime_headers = {
        'In-Reply-To': params.messageId,
        References: params.messageId,
      };
    }

    try {
      const apiUrl = resolveApiUrl(env);
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${token}`,
        },
        body: JSON.stringify(body),
      });

      const textBody = await res.text();
      let data = {};
      try {
        data = textBody ? JSON.parse(textBody) : {};
      } catch {
        data = { raw: textBody };
      }

      const apiError = data?.error && typeof data.error === 'object' ? data.error : null;
      if (!res.ok || apiError) {
        const detail = parseZeptomailError(data, textBody, res.status);
        let hint = '';
        if (detail.includes('SM_111') || detail.includes('not verified') || detail.includes('domain')) {
          hint = '（请确认 ZeptoMail 中域名已验证，且发件地址属于已验证域名）';
        } else if (res.status === 401 || res.status === 403 || detail.includes('401')) {
          hint = '（请检查 ZEPTOMAIL_TOKEN 是否为 Send Mail Token）';
        }
        return { error: { message: `ZeptoMail 发信失败: ${detail}${hint}` } };
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
