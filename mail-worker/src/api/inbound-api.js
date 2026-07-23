import app from '../hono/hono';
import result from '../model/result';
import { verifyInboundWebhookSecret } from '../email/inbound-auth';
import { processInboundMime } from '../email/process-inbound';
import { fetchRawMimeFromS3 } from '../email/inbound-s3';

function decodeRawMime(body) {
	if (body.rawBase64) {
		const b64 = String(body.rawBase64).replace(/\s+/g, '');
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return new TextDecoder().decode(bytes);
	}
	if (body.raw) return String(body.raw);
	return '';
}

function pickRecipient(body, parsedSes) {
	const direct = (body.to || body.recipient || '').trim().toLowerCase();
	if (direct) return direct;
	if (parsedSes?.mail?.destination?.length) {
		return String(parsedSes.mail.destination[0]).trim().toLowerCase();
	}
	return '';
}

function parseSesNotificationPayload(body) {
	if (body.notificationType || body.mail) return body;
	if (body.Type === 'Notification' && body.Message) {
		try {
			return JSON.parse(body.Message);
		} catch {
			return null;
		}
	}
	if (body.Message && typeof body.Message === 'object') return body.Message;
	return null;
}

async function resolveInboundPayload(c, body) {
	const toDirect = pickRecipient(body, null);
	const rawDirect = decodeRawMime(body);
	if (toDirect && rawDirect) {
		return { to: toDirect, rawMime: rawDirect };
	}

	const ses = parseSesNotificationPayload(body);
	if (!ses || ses.notificationType !== 'Received') {
		return null;
	}

	const to = pickRecipient(body, ses);
	if (!to) return null;

	const s3Action = ses.receipt?.action;
	if (s3Action?.type === 'S3' && s3Action.bucketName && s3Action.objectKey) {
		const rawMime = await fetchRawMimeFromS3(c.env, s3Action.bucketName, s3Action.objectKey);
		return { to, rawMime, source: 'ses-s3' };
	}

	const rawFromBody = decodeRawMime(body);
	if (rawFromBody) {
		return { to, rawMime: rawFromBody, source: 'ses-body' };
	}

	return null;
}

async function handleInbound(c, body) {
	const auth = verifyInboundWebhookSecret(c);
	if (!auth.ok) {
		return c.json(result.fail(auth.message, auth.status), auth.status);
	}

	const resolved = await resolveInboundPayload(c, body);
	if (!resolved?.to || !resolved?.rawMime) {
		return c.json(result.fail('缺少 to/recipient 与 raw/rawBase64，或无法解析 SES Received 通知', 400), 400);
	}

	const outcome = await processInboundMime(c, {
		rawMime: resolved.rawMime,
		toAddress: resolved.to,
	});

	if (!outcome.ok) {
		const code = outcome.rejectReason === 'Service suspended' ? 503 : 422;
		return c.json(result.fail(outcome.rejectReason || '收件被拒绝', code), code);
	}

	return c.json(
		result.ok({
			emailId: outcome.emailId,
			to: resolved.to,
			source: resolved.source || 'mime',
			skippedForward: outcome.skippedForward || false,
		}),
	);
}

app.post('/inbound/mime', async (c) => {
	try {
		const body = await c.req.json();
		return await handleInbound(c, body);
	} catch (e) {
		console.error('[inbound/mime]', e);
		return c.json(result.fail(e instanceof Error ? e.message : String(e)), 500);
	}
});

/** 兼容 AWS SES → SNS → Lambda 直 POST 的 Received 通知 */
app.post('/inbound/ses', async (c) => {
	try {
		const body = await c.req.json();
		return await handleInbound(c, body);
	} catch (e) {
		console.error('[inbound/ses]', e);
		return c.json(result.fail(e instanceof Error ? e.message : String(e)), 500);
	}
});
