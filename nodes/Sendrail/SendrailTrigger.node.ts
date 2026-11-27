import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	IHttpRequestMethods,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import { sendrailError } from './Sendrail.node';

export function signatureOk(secret: string, rawBody: Buffer | string, header: unknown): boolean {
	if (typeof header !== 'string') return false;
	const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'));
	const given = Buffer.from(header.trim());
	return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The key's webhook as Sendrail holds it: GET, PUT {url} or DELETE /v1/webhook. */
async function keyWebhook(ctx: IHookFunctions, method: IHttpRequestMethods, url?: string): Promise<IDataObject> {
	const credentials = await ctx.getCredentials('sendrailApi');
	const baseUrl = String(credentials.baseUrl || 'https://api.sendrail.cz').replace(/\/+$/, '');
	try {
		return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'sendrailApi', {
			method,
			url: `${baseUrl}/v1/webhook`,
			body: url ? { url } : undefined,
			json: true,
			timeout: 25000,
		})) as IDataObject;
	} catch (error) {
		const said = sendrailError(error);
		if (said?.code === 'webhook_api_disabled') {
			throw new NodeApiError(ctx.getNode(), error as JsonObject, {
				message:
					'This API key is not allowed to manage its webhook. In the Sendrail dashboard (sendrail.cz/app → Keys) tick "Povolit správu webhooku přes API" at this key, save it and activate the workflow again.',
			});
		}
		throw new NodeApiError(
			ctx.getNode(),
			error as JsonObject,
			said ? { message: said.message, description: `Sendrail error code: ${said.code}` } : {},
		);
	}
}

export class SendrailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sendrail Trigger',
		name: 'sendrailTrigger',
		icon: 'file:sendrail.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a message reaches its final status, a reply or missed call arrives, or somebody opts out',
		defaults: { name: 'Sendrail Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sendrailApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName:
					'The node sets the webhook address of the API key by itself. Allow it first: in the Sendrail dashboard (sendrail.cz/app → Keys) tick "Povolit správu webhooku přes API" at the key. A key has one webhook address, so use a separate key for each workflow with this trigger, and another one while testing.',
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
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const current = await keyWebhook(this, 'GET');
				if (current.url !== this.getNodeWebhookUrl('default')) return false;
				this.getWorkflowStaticData('node').secret = current.secret;
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const set = await keyWebhook(this, 'PUT', this.getNodeWebhookUrl('default') as string);
				this.getWorkflowStaticData('node').secret = set.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				// the key has one address: remove it only while it is still ours
				const current = await keyWebhook(this, 'GET');
				if (current.url === this.getNodeWebhookUrl('default')) await keyWebhook(this, 'DELETE');
				delete this.getWorkflowStaticData('node').secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const secret = String(this.getWorkflowStaticData('node').secret ?? '');
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody;

		// the signing secret came from Sendrail when the webhook was registered; nothing unsigned gets in
		if (!secret || !raw || !signatureOk(secret, raw, req.headers['x-sendrail-signature'])) {
			res.status(401).json({ error: 'invalid signature' });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events', []) as string[];
		if (!events.includes(String(body.event))) {
			res.status(200).json({ ok: true, ignored: true });
			return { noWebhookResponse: true };
		}
		// message.final carries the message under "message", the other events under "data"
		const payload = (body.message || body.data || {}) as IDataObject;
		return { webhookResponse: { ok: true }, workflowData: [this.helpers.returnJsonArray([{ event: body.event, ...payload }])] };
	}
}
