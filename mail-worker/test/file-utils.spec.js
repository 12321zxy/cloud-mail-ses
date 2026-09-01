import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import fileUtils from '../src/utils/file-utils';

const deliveryStatusNotification = [
	'From: MAILER-DAEMON@example.com',
	'To: sender@example.com',
	'Subject: Delivery Status Notification (Failure)',
	'MIME-Version: 1.0',
	'Content-Type: multipart/report; report-type=delivery-status; boundary="dsn-boundary"',
	'',
	'--dsn-boundary',
	'Content-Type: text/plain; charset=utf-8',
	'',
	'Delivery failed.',
	'--dsn-boundary',
	'Content-Type: message/delivery-status',
	'',
	'Reporting-MTA: dns; example.com',
	'Final-Recipient: rfc822; missing@example.net',
	'Action: failed',
	'Status: 5.1.1',
	'--dsn-boundary',
	'Content-Type: message/rfc822',
	'',
	'From: sender@example.com',
	'To: missing@example.net',
	'Subject: Original message',
	'',
	'Original body.',
	'--dsn-boundary--',
	'',
].join('\r\n');

describe('attachment filename normalization', () => {
	it('provides stable names for unnamed DSN MIME parts', async () => {
		const parsed = await PostalMime.parse(deliveryStatusNotification);
		const names = parsed.attachments.map((attachment) =>
			fileUtils.getAttachmentFileName(attachment.filename, attachment.mimeType),
		);

		expect(names).toContain('delivery-status.txt');
		expect(names).toContain('original-message.eml');
	});

	it('keeps a supplied filename and safely handles missing extensions', () => {
		expect(fileUtils.getAttachmentFileName(' report.pdf ', 'application/pdf')).toBe('report.pdf');
		expect(fileUtils.getAttachmentFileName(null, 'application/octet-stream')).toBe('attachment');
		expect(fileUtils.getExtFileName(null)).toBe('');
		expect(fileUtils.getExtFileName('delivery-status.txt')).toBe('.txt');
	});
});
