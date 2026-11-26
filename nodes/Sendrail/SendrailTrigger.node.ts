import { createHmac, timingSafeEqual } from 'crypto';
import type { IDataObject, INodeType, INodeTypeDescription, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';

export function signatureOk(secret: string, rawBody: Buffer | string, header: unknown): boolean {
	if (typeof header !== 'string') return false;
	const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'));
	const given = Buffer.from(header.trim());
	return given.length === expected.length && timingSafeEqual(given, expected);
}

export class SendrailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sendrail Trigger',
		name: 'sendrailTrigger',
		icon: 'file:sendrail.png',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a message reaches its final status, a reply or missed call arrives, or somebody opts out',
		defaults: { name: 'Sendrail Trigger' },
		inputs: [],
		outputs: ['main'],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName:
					'Copy the Production URL above into the "Webhook" field of your API key in the Sendrail dashboard (sendrail.cz/app → Keys) and save the key. Sendrail has one webhook address per key.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{ name: 'Message Final', value: 'message.final', description: 'A sent message ended as sent, failed, cancelled or rejected' },
					{ name: 'Message Received', value: 'message.received', description: 'A reply arrived (inbound must be switched on for the account)' },
					{ name: 'Missed Call', value: 'call.missed', description: 'Somebody called the sending number' },
					{ name: 'Opt-Out Created', value: 'optout.created', description: 'Somebody replied STOP and was put on the opt-out list' },
				],
				default: ['message.final'],
				required: true,
				description: 'Other events are acknowledged and do not start the workflow',
			},
			{
				displayName: 'Signing Secret',
				name: 'secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'The "Podpisový klíč webhooku" shown next to the key in the Sendrail dashboard. When filled in, requests without a valid X-Sendrail-Signature are refused. Recommended: without it anybody who learns the URL can start the workflow.',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const secret = (this.getNodeParameter('secret', '') as string).trim();

		if (secret) {
			const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
			if (!raw || !signatureOk(secret, raw, req.headers['x-sendrail-signature'])) {
				res.status(401).json({ error: 'invalid signature' });
				return { noWebhookResponse: true };
			}
		}

		const body = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events', []) as string[];
		if (!events.includes(String(body.event))) {
			res.status(200).json({ ok: true, ignored: true });
			return { noWebhookResponse: true };
		}
		// message.final carries the message under "message", the other events under "data"
		const payload = (body.message || body.data || {}) as IDataObject;
		return { workflowData: [this.helpers.returnJsonArray([{ event: body.event, ...payload }])] };
	}
}
