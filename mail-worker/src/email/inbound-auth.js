/** 校验 HTTP 收件 Webhook 密钥（未配置时接口保持关闭，不影响 CF Email Routing） */
export function verifyInboundWebhookSecret(c) {
	const expected = (c.env.INBOUND_WEBHOOK_SECRET || '').trim();
	if (!expected) {
		return { ok: false, status: 503, message: 'INBOUND_WEBHOOK_SECRET 未配置，HTTP 收件未启用' };
	}
	const header =
		c.req.header('X-Inbound-Secret') ||
		c.req.header('x-inbound-secret') ||
		'';
	const auth = c.req.header('Authorization') || '';
	const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
	const provided = (header || bearer).trim();
	if (!provided || provided !== expected) {
		return { ok: false, status: 401, message: 'Inbound webhook 鉴权失败' };
	}
	return { ok: true };
}
