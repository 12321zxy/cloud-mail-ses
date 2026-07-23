import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';

function createS3Client(env) {
	const region = (env.AWS_REGION || 'us-east-1').trim();
	const accessKeyId = (env.AWS_ACCESS_KEY_ID || '').trim();
	const secretAccessKey = (env.AWS_SECRET_ACCESS_KEY || '').trim();
	if (!accessKeyId || !secretAccessKey) return null;
	return new S3Client({
		region,
		credentials: { accessKeyId, secretAccessKey },
		requestHandler: new FetchHttpHandler(),
	});
}

export async function fetchRawMimeFromS3(env, bucket, key) {
	const client = createS3Client(env);
	if (!client) {
		throw new Error('未配置 AWS 凭证，无法从 S3 拉取收件');
	}
	const out = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);
	const body = out.Body;
	if (!body) throw new Error('S3 对象为空');
	if (typeof body.transformToByteArray === 'function') {
		const bytes = await body.transformToByteArray();
		return new TextDecoder().decode(bytes);
	}
	const chunks = [];
	for await (const chunk of body) {
		chunks.push(chunk);
	}
	const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder().decode(merged);
}
