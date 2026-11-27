import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

async function call(
	ctx: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const credentials = await ctx.getCredentials('sendrailApi');
	const baseUrl = String(credentials.baseUrl || 'https://api.sendrail.cz').replace(/\/+$/, '');
	return (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'sendrailApi', {
		method,
		url: `${baseUrl}${path}`,
		body,
		qs,
		json: true,
		timeout: 25000,
	})) as IDataObject;
}

/** What Sendrail said in the body of a failed request: {"error": {"code", "message"}}. */
export function sendrailError(error: unknown): { code: string; message: string } | undefined {
	const e = error as IDataObject;
	const response = (e.response ?? (e.cause as IDataObject | undefined)?.response) as IDataObject | undefined;
	const candidates = [response?.data, response?.body, (e.context as IDataObject | undefined)?.data, e.error, e.description];
	for (let body of candidates) {
		if (typeof body === 'string') {
			try {
				body = JSON.parse(body);
			} catch {
				continue;
			}
		}
		const inner = (body as IDataObject | undefined)?.error as IDataObject | undefined;
		if (inner && typeof inner === 'object' && typeof inner.code === 'string') {
			return { code: inner.code, message: String(inner.message ?? '') };
		}
	}
	return undefined;
}

function variables(ctx: IExecuteFunctions, i: number): IDataObject | undefined {
	const rows = (ctx.getNodeParameter('variables.values', i, []) as Array<{ name: string; value: string }>) || [];
	if (!rows.length) return undefined;
	const out: IDataObject = {};
	for (const row of rows) if (row.name) out[row.name] = row.value;
	return out;
}

export class Sendrail implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Sendrail',
		name: 'sendrail',
		icon: 'file:sendrail.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send SMS and verification codes, check numbers and manage opt-outs with Sendrail',
		defaults: { name: 'Sendrail' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'sendrailApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Message', value: 'message' },
					{ name: 'Number', value: 'number' },
					{ name: 'Opt-Out', value: 'optOut' },
					{ name: 'Verification', value: 'verification' },
				],
				default: 'message',
			},

			// ---- message
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{ name: 'Cancel', value: 'cancel', action: 'Cancel a message', description: 'Cancel a message that has not left yet' },
					{ name: 'Get', value: 'get', action: 'Get a message', description: 'Get a message and its status' },
					{ name: 'Get Many', value: 'getAllInbound', action: 'Get replies and missed calls', description: 'Get the latest replies and missed calls (inbound must be switched on for the account)' },
					{ name: 'Send', value: 'send', action: 'Send a message', description: 'Send an SMS' },
				],
				default: 'send',
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+420777123456',
				description: 'Recipient in international format. Nine digits without a prefix are taken as Czech.',
				displayOptions: { show: { resource: ['message', 'verification'], operation: ['send'] } },
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Text', value: 'text' },
					{ name: 'Stored Template', value: 'template' },
				],
				default: 'text',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				description:
					'160 characters fit in one segment; one character with diacritics or an emoji lowers it to 70. At most 10 segments.',
				displayOptions: { show: { resource: ['message'], operation: ['send'], content: ['text'] } },
			},
			{
				displayName: 'Template Name',
				name: 'template',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'order-ready',
				description: 'Name of a template stored in the Sendrail dashboard',
				displayOptions: { show: { resource: ['message'], operation: ['send'], content: ['template'] } },
			},
			{
				displayName: 'Variables',
				name: 'variables',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Variable',
				default: {},
				description: 'Values for the {{name}} places of the template',
				displayOptions: { show: { resource: ['message'], operation: ['send'], content: ['template'] } },
				options: [
					{
						displayName: 'Variable',
						name: 'values',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				options: [
					{
						displayName: 'Bulk',
						name: 'bulk',
						type: 'boolean',
						default: false,
						description:
							'Whether this is a mass mailing (newsletter, campaign). Bulk messages have the lowest priority and leave gradually in daytime hours; campaigns must be marked this way.',
					},
					{
						displayName: 'Dry Run',
						name: 'dryRun',
						type: 'boolean',
						default: false,
						description: 'Whether to only check and price the message. Nothing is sent or charged.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						placeholder: 'order-1042-ready',
						description:
							'Up to 120 characters. The same key returns the first message instead of sending again, so a retried execution does not text the person twice.',
					},
				],
			},
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'msg_5f0c9a1e7b2d4c8a9e01',
				displayOptions: { show: { resource: ['message'], operation: ['get', 'cancel'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['message'], operation: ['getAllInbound'] } },
			},

			// ---- verification
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['verification'] } },
				options: [
					{ name: 'Check', value: 'check', action: 'Check a verification code', description: 'Check the code the person typed' },
					{ name: 'Get', value: 'get', action: 'Get a verification', description: 'Get the state of a verification' },
					{ name: 'Send', value: 'send', action: 'Send a verification code', description: 'Send a one-time code by SMS' },
				],
				default: 'send',
			},
			{
				displayName: 'Options',
				name: 'verifyOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['verification'], operation: ['send'] } },
				options: [
					{
						displayName: 'App Name',
						name: 'app',
						type: 'string',
						default: '',
						description: 'Put in front of the text, at most 20 characters',
					},
					{
						displayName: 'Code Length',
						name: 'length',
						type: 'number',
						typeOptions: { minValue: 4, maxValue: 8 },
						default: 6,
					},
					{
						displayName: 'Language',
						name: 'lang',
						type: 'options',
						options: [
							{ name: 'Czech', value: 'cs' },
							{ name: 'English', value: 'en' },
							{ name: 'Slovak', value: 'sk' },
						],
						default: 'cs',
					},
					{
						displayName: 'Template Name',
						name: 'template',
						type: 'string',
						default: '',
						description: 'Your own stored template instead of the standard text; it must contain {{code}}',
					},
					{
						displayName: 'Valid For (Seconds)',
						name: 'ttl',
						type: 'number',
						typeOptions: { minValue: 60, maxValue: 900 },
						default: 300,
					},
				],
			},
			{
				displayName: 'Verification ID',
				name: 'verificationId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'ver_3b1f0c9a1e7b2d4c8a9e01aa',
				description: 'The ID returned by the Send operation',
				displayOptions: { show: { resource: ['verification'], operation: ['check', 'get'] } },
			},
			{
				displayName: 'Code',
				name: 'code',
				type: 'string',
				required: true,
				default: '',
				description: 'The code the person typed. The answer has "valid": true exactly once.',
				displayOptions: { show: { resource: ['verification'], operation: ['check'] } },
			},

			// ---- number
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['number'] } },
				options: [
					{
						name: 'Check',
						value: 'check',
						action: 'Check a phone number',
						description: 'Validate a number and get its country, kind and price without sending. Free.',
					},
				],
				default: 'check',
			},
			{
				displayName: 'Number',
				name: 'number',
				type: 'string',
				required: true,
				default: '',
				placeholder: '777 123 456',
				displayOptions: { show: { resource: ['number', 'optOut'], operation: ['check', 'add', 'remove'] } },
			},

			// ---- opt-out
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['optOut'] } },
				options: [
					{ name: 'Add', value: 'add', action: 'Add a number to the opt out list', description: 'Stop sending to a number' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many opt outs', description: 'List the numbers the account must not write to' },
					{ name: 'Remove', value: 'remove', action: 'Remove a number from the opt out list', description: 'Allow sending to a number again' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Scope',
				name: 'scope',
				type: 'options',
				options: [
					{ name: 'Everything', value: 'all', description: 'Nothing is sent to the number' },
					{ name: 'Bulk Only', value: 'bulk', description: 'Only mass mailings are held back' },
				],
				default: 'all',
				displayOptions: { show: { resource: ['optOut'], operation: ['add'] } },
			},
			{
				displayName: 'Note',
				name: 'note',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['optOut'], operation: ['add'] } },
			},

			// ---- account
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get the account', description: 'Credit, plan, limits and usage of the key' },
				],
				default: 'get',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			try {
				let result: IDataObject | IDataObject[];

				if (resource === 'message' && operation === 'send') {
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const body: IDataObject = { to: this.getNodeParameter('to', i) as string };
					if (this.getNodeParameter('content', i) === 'template') {
						body.template = this.getNodeParameter('template', i) as string;
						const vars = variables(this, i);
						if (vars) body.variables = vars;
					} else {
						body.message = this.getNodeParameter('message', i) as string;
					}
					if (options.idempotencyKey) body.idempotency_key = options.idempotencyKey;
					if (options.dryRun) body.dry_run = true;
					if (options.bulk) body.type = 'bulk';
					result = await call(this, 'POST', '/v1/messages', body);
				} else if (resource === 'message' && operation === 'get') {
					result = await call(this, 'GET', `/v1/messages/${encodeURIComponent(this.getNodeParameter('messageId', i) as string)}`);
				} else if (resource === 'message' && operation === 'cancel') {
					result = await call(this, 'POST', `/v1/messages/${encodeURIComponent(this.getNodeParameter('messageId', i) as string)}/cancel`);
				} else if (resource === 'message' && operation === 'getAllInbound') {
					const answer = await call(this, 'GET', '/v1/inbound', undefined, { limit: this.getNodeParameter('limit', i, 50) as number });
					result = (answer.items as IDataObject[]) || [];
				} else if (resource === 'verification' && operation === 'send') {
					const options = this.getNodeParameter('verifyOptions', i, {}) as IDataObject;
					const body: IDataObject = { to: this.getNodeParameter('to', i) as string };
					for (const name of ['app', 'length', 'lang', 'template', 'ttl']) {
						if (options[name] !== undefined && options[name] !== '') body[name] = options[name];
					}
					result = await call(this, 'POST', '/v1/verify', body);
				} else if (resource === 'verification' && operation === 'check') {
					const id = encodeURIComponent(this.getNodeParameter('verificationId', i) as string);
					result = await call(this, 'POST', `/v1/verify/${id}/check`, { code: String(this.getNodeParameter('code', i)).trim() });
				} else if (resource === 'verification' && operation === 'get') {
					result = await call(this, 'GET', `/v1/verify/${encodeURIComponent(this.getNodeParameter('verificationId', i) as string)}`);
				} else if (resource === 'number' && operation === 'check') {
					result = await call(this, 'POST', '/v1/numbers/check', { number: this.getNodeParameter('number', i) as string });
				} else if (resource === 'optOut' && operation === 'getAll') {
					const answer = await call(this, 'GET', '/v1/optouts');
					result = (answer.items as IDataObject[]) || [];
				} else if (resource === 'optOut' && operation === 'add') {
					const body: IDataObject = {
						number: this.getNodeParameter('number', i) as string,
						scope: this.getNodeParameter('scope', i) as string,
					};
					const note = this.getNodeParameter('note', i, '') as string;
					if (note) body.note = note;
					result = await call(this, 'POST', '/v1/optouts', body);
				} else if (resource === 'optOut' && operation === 'remove') {
					const number = String(this.getNodeParameter('number', i)).replace(/[\s\-()]/g, '');
					result = await call(this, 'DELETE', `/v1/optouts/${encodeURIComponent(number)}`);
				} else if (resource === 'account' && operation === 'get') {
					result = await call(this, 'GET', '/v1/account');
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation: ${resource} / ${operation}`, { itemIndex: i });
				}

				for (const json of Array.isArray(result) ? result : [result]) {
					out.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				const said = sendrailError(error);
				if (this.continueOnFail()) {
					out.push({
						json: said ? { error: said.message, code: said.code } : { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				throw new NodeApiError(
					this.getNode(),
					error as JsonObject,
					said ? { itemIndex: i, message: said.message, description: `Sendrail error code: ${said.code}` } : { itemIndex: i },
				);
			}
		}
		return [out];
	}
}
