import { processInboundMime, readCfRawMime } from './process-inbound';

/** Cloudflare Email Routing → Worker 收件（原有通道，行为不变） */
export async function email(message, env, ctx) {
	try {
		const content = await readCfRawMime(message);
		const outcome = await processInboundMime(
			{ env },
			{
				rawMime: content,
				toAddress: message.to,
				cfMessage: message,
			},
		);

		if (!outcome.ok && outcome.rejectReason) {
			message.setReject(outcome.rejectReason);
		}
	} catch (e) {
		console.error('邮件接收异常: ', e);
		throw e;
	}
}
