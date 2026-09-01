import PostalMime from 'postal-mime';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import settingService from '../service/setting-service';
import attService from '../service/att-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import { emailConst, isDel, settingConst } from '../const/entity-const';
import emailUtils from '../utils/email-utils';
import roleService from '../service/role-service';
import userService from '../service/user-service';
import telegramService from '../service/telegram-service';
import aiService from '../service/ai-service';

export function checkBlock(blackSubjectStr, blackContentStr, blackFromStr, parsed) {
	const blackFromList = blackFromStr ? blackFromStr.split(',') : [];
	const blackContentList = blackContentStr ? blackContentStr.split(',') : [];
	const blackSubjectList = blackSubjectStr ? blackSubjectStr.split(',') : [];

	for (const blackSubject of blackSubjectList) {
		if (parsed.subject?.includes(blackSubject)) {
			return true;
		}
	}

	for (const blackContent of blackContentList) {
		if (parsed.html?.includes(blackContent) || parsed.text?.includes(blackContent)) {
			return true;
		}
	}

	for (const blackFrom of blackFromList) {
		if (
			parsed.from?.address === blackFrom ||
			emailUtils.getDomain(parsed.from?.address || '') === blackFrom
		) {
			return true;
		}
	}

	return false;
}

/** 从 CF Email Worker message 读取 raw MIME */
export async function readCfRawMime(message) {
	const reader = message.raw.getReader();
	let content = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		content += new TextDecoder().decode(value);
	}
	return content;
}

/**
 * 统一收件处理（CF Email Routing 与 HTTP/SES Inbound 共用）
 * @param {object} c - { env } 或 Hono context
 * @param {{ rawMime: string, toAddress: string, cfMessage?: object }} opts
 * @returns {Promise<{ ok: boolean, rejectReason?: string, emailId?: number, skippedForward?: boolean }>}
 */
export async function processInboundMime(c, opts) {
	const { rawMime, toAddress, cfMessage } = opts;
	const env = c.env;
	const to = (toAddress || '').trim().toLowerCase();
	if (!to || !rawMime) {
		return { ok: false, rejectReason: 'Missing recipient or raw MIME' };
	}

	const {
		receive,
		tgChatId,
		tgBotStatus,
		forwardStatus,
		forwardEmail,
		ruleEmail,
		ruleType,
		r2Domain,
		noRecipient,
		blackSubject,
		blackContent,
		blackFrom,
		aiCode,
		aiCodeFilter,
	} = await settingService.query(c);

	if (receive === settingConst.receive.CLOSE) {
		return { ok: false, rejectReason: 'Service suspended' };
	}

	const parsed = await PostalMime.parse(rawMime);

	if (checkBlock(blackSubject, blackContent, blackFrom, parsed)) {
		return { ok: false, rejectReason: 'Message rejected' };
	}

	const account = await accountService.selectByEmailIncludeDel({ env }, to);

	if (!account && noRecipient === settingConst.noRecipient.CLOSE) {
		return { ok: false, rejectReason: 'Recipient not found' };
	}

	let userRow = {};
	if (account) {
		userRow = await userService.selectByIdIncludeDel({ env }, account.userId);
	}

	if (account && userRow.email !== env.admin) {
		const { banEmail, availDomain } = await roleService.selectByUserId({ env }, account.userId);

		if (!roleService.hasAvailDomainPerm(availDomain, to)) {
			return { ok: false, rejectReason: 'The recipient is not authorized to use this domain.' };
		}

		if (roleService.isBanEmail(banEmail, parsed.from?.address || '')) {
			return { ok: false, rejectReason: 'The recipient is disabled from receiving emails.' };
		}
	}

	if (!parsed.to) {
		parsed.to = [{ address: to, name: emailUtils.getName(to) }];
	}

	const toName = parsed.to.find((item) => item.address?.toLowerCase() === to)?.name || '';
	const code = await aiService.extractCode({ env }, parsed, { aiCode, aiCodeFilter });

	const params = {
		toEmail: to,
		toName,
		sendEmail: parsed.from?.address || '',
		name: parsed.from?.name || emailUtils.getName(parsed.from?.address || ''),
		subject: parsed.subject,
		code,
		content: parsed.html,
		text: parsed.text,
		cc: parsed.cc ? JSON.stringify(parsed.cc) : '[]',
		bcc: parsed.bcc ? JSON.stringify(parsed.bcc) : '[]',
		recipient: JSON.stringify(parsed.to),
		inReplyTo: parsed.inReplyTo,
		relation: parsed.references,
		messageId: parsed.messageId,
		userId: account ? account.userId : 0,
		accountId: account ? account.accountId : 0,
		isDel: isDel.DELETE,
		status: emailConst.status.SAVING,
	};

	const attachments = [];
	const cidAttachments = [];

	for (const item of parsed.attachments || []) {
		const attachment = { ...item };
		attachment.filename = fileUtils.getAttachmentFileName(item.filename, item.mimeType);
		attachment.key =
			constant.ATTACHMENT_PREFIX +
			(await fileUtils.getBuffHash(attachment.content)) +
			fileUtils.getExtFileName(attachment.filename);
		attachment.size = item.content?.length ?? item.content?.byteLength;
		attachments.push(attachment);
		if (attachment.contentId) {
			cidAttachments.push(attachment);
		}
	}

	let emailRow = await emailService.receive({ env }, params, cidAttachments, r2Domain);

	attachments.forEach((attachment) => {
		attachment.emailId = emailRow.emailId;
		attachment.userId = emailRow.userId;
		attachment.accountId = emailRow.accountId;
	});

	try {
		if (attachments.length > 0) {
			await attService.addAtt({ env }, attachments);
		}
	} catch (e) {
		console.error(e);
	}

	emailRow = await emailService.completeReceive(
		{ env },
		account ? emailConst.status.RECEIVE : emailConst.status.NOONE,
		emailRow.emailId,
	);

	if (ruleType === settingConst.ruleType.RULE) {
		const emails = (ruleEmail || '').split(',');
		if (!emails.includes(to)) {
			return { ok: true, emailId: emailRow.emailId, skippedForward: true };
		}
	}

	if (tgBotStatus === settingConst.tgBotStatus.OPEN && tgChatId) {
		await telegramService.sendEmailToBot({ env }, emailRow);
	}

	if (forwardStatus === settingConst.forwardStatus.OPEN && forwardEmail) {
		const emails = forwardEmail.split(',').filter(Boolean);
		if (cfMessage) {
			await Promise.all(
				emails.map(async (addr) => {
					try {
						await cfMessage.forward(addr);
					} catch (e) {
						console.error(`转发邮箱 ${addr} 失败：`, e);
					}
				}),
			);
		} else {
			console.warn(
				'[inbound] 邮件转发到其他邮箱仅支持 CF Email Routing 通道，HTTP/SES Inbound 已跳过 message.forward',
			);
		}
	}

	return { ok: true, emailId: emailRow.emailId };
}
