// Loads the built nodes and runs every operation against a fake HTTP helper: checks the
// requests we would make and the trigger's signature handling. No network, no n8n needed.
const assert = require('assert');
const { createHmac } = require('crypto');
const { Sendrail } = require('../dist/nodes/Sendrail/Sendrail.node.js');
const { SendrailTrigger, signatureOk } = require('../dist/nodes/Sendrail/SendrailTrigger.node.js');
const { SendrailApi } = require('../dist/credentials/SendrailApi.credentials.js');
const pkg = require('../package.json');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed++; console.log('PASS  ' + what); };
const get = (obj, path, dflt) => { const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); return v === undefined ? dflt : v; };

async function run(params, answer = { ok: true }, opts = {}) {
	const calls = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, dflt) => get(params, name, dflt),
		getCredentials: async () => ({ apiKey: 'sr_test_x', baseUrl: 'https://api.sendrail.cz/' }),
		getNode: () => ({ name: 'Sendrail', type: 'sendrail', typeVersion: 1 }),
		continueOnFail: () => !!opts.continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async function (cred, req) {
				calls.push({ cred, ...req });
				if (opts.fail) throw Object.assign(new Error('Request failed with status code 402'), { httpCode: '402' });
				return answer;
			},
		},
	};
	const out = await new Sendrail().execute.call(ctx);
	return { calls, out: out[0] };
}

(async () => {
	for (const f of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) ok(require('fs').existsSync(f), 'built file exists: ' + f);
	ok(require('fs').existsSync('dist/nodes/Sendrail/sendrail.svg') && require('fs').existsSync('dist/credentials/sendrail.svg'), 'icons are copied');
	const cred = new SendrailApi();
	ok(cred.name === 'sendrailApi' && cred.authenticate.properties.headers.Authorization.includes('Bearer'), 'credential sends the key as a Bearer header');

	let r = await run({ resource: 'message', operation: 'send', to: '+420777123456', content: 'text', message: 'Hi', options: { idempotencyKey: 'k1' } }, { id: 'msg_1' });
	ok(r.calls[0].method === 'POST' && r.calls[0].url === 'https://api.sendrail.cz/v1/messages' && r.calls[0].cred === 'sendrailApi', 'send: POST /v1/messages with the credential');
	ok(JSON.stringify(r.calls[0].body) === JSON.stringify({ to: '+420777123456', message: 'Hi', idempotency_key: 'k1' }), 'send: body has to, message, idempotency_key and nothing else');
	ok(r.out[0].json.id === 'msg_1' && r.out[0].pairedItem.item === 0, 'send: the answer becomes the item');

	r = await run({ resource: 'message', operation: 'send', to: '777123456', content: 'template', template: 'order-ready', variables: { values: [{ name: 'name', value: 'Jana' }, { name: '', value: 'x' }] }, options: { dryRun: true, bulk: true } });
	ok(JSON.stringify(r.calls[0].body) === JSON.stringify({ to: '777123456', template: 'order-ready', variables: { name: 'Jana' }, dry_run: true, type: 'bulk' }), 'send with a template: variables, dry_run and bulk');

	r = await run({ resource: 'message', operation: 'get', messageId: 'msg_a/b' });
	ok(r.calls[0].method === 'GET' && r.calls[0].url.endsWith('/v1/messages/msg_a%2Fb'), 'get: the id is escaped');
	r = await run({ resource: 'message', operation: 'cancel', messageId: 'msg_1' });
	ok(r.calls[0].method === 'POST' && r.calls[0].url.endsWith('/v1/messages/msg_1/cancel'), 'cancel');
	r = await run({ resource: 'message', operation: 'getAllInbound', limit: 5 }, { items: [{ id: 1 }, { id: 2 }] });
	ok(r.calls[0].url.endsWith('/v1/inbound') && r.calls[0].qs.limit === 5 && r.out.length === 2, 'inbound: every reply is its own item');

	r = await run({ resource: 'verification', operation: 'send', to: '+420777123456', verifyOptions: { app: 'Shop', ttl: 120, template: '' } });
	ok(r.calls[0].url.endsWith('/v1/verify') && JSON.stringify(r.calls[0].body) === JSON.stringify({ to: '+420777123456', app: 'Shop', ttl: 120 }), 'verification send: only the options that were set');
	r = await run({ resource: 'verification', operation: 'check', verificationId: 'ver_1', code: ' 482913 ' }, { valid: true });
	ok(r.calls[0].url.endsWith('/v1/verify/ver_1/check') && r.calls[0].body.code === '482913' && r.out[0].json.valid === true, 'verification check: code trimmed, valid passed on');
	r = await run({ resource: 'verification', operation: 'get', verificationId: 'ver_1' });
	ok(r.calls[0].method === 'GET' && r.calls[0].url.endsWith('/v1/verify/ver_1'), 'verification get');

	r = await run({ resource: 'number', operation: 'check', number: '777 123 456' });
	ok(r.calls[0].url.endsWith('/v1/numbers/check') && r.calls[0].body.number === '777 123 456', 'number check');
	r = await run({ resource: 'optOut', operation: 'getAll' }, { items: [{ number: '+420777123456' }] });
	ok(r.calls[0].url.endsWith('/v1/optouts') && r.out[0].json.number === '+420777123456', 'opt-outs list');
	r = await run({ resource: 'optOut', operation: 'add', number: '+420777123456', scope: 'bulk', note: '' });
	ok(JSON.stringify(r.calls[0].body) === JSON.stringify({ number: '+420777123456', scope: 'bulk' }), 'opt-out add');
	r = await run({ resource: 'optOut', operation: 'remove', number: '+420 777 123 456' });
	ok(r.calls[0].method === 'DELETE' && r.calls[0].url.endsWith('/v1/optouts/%2B420777123456'), 'opt-out remove: the plus sign is escaped');
	r = await run({ resource: 'account', operation: 'get' });
	ok(r.calls[0].url.endsWith('/v1/account'), 'account');

	r = await run({ resource: 'account', operation: 'get' }, {}, { fail: true, continueOnFail: true });
	ok(r.out[0].json.error.includes('402'), 'an error becomes an item when the node may continue on fail');
	let threw = false;
	try { await run({ resource: 'account', operation: 'get' }, {}, { fail: true }); } catch (e) { threw = e.constructor.name === 'NodeApiError'; }
	ok(threw, 'otherwise it stops the workflow with an API error');

	// trigger
	const raw = Buffer.from('{"event":"message.final","message":{"id":"msg_1","status":"sent"}}');
	const sig = 'sha256=' + createHmac('sha256', 's3cret').update(raw).digest('hex');
	ok(signatureOk('s3cret', raw, sig) && !signatureOk('other', raw, sig) && !signatureOk('s3cret', raw, undefined) && !signatureOk('s3cret', raw, 'sha256=00'), 'signature check');

	async function hook(params, rawBody, headers) {
		const sent = {};
		const ctx = {
			getRequestObject: () => ({ rawBody, headers }),
			getResponseObject: () => ({ status: (c) => { sent.code = c; return { json: (b) => { sent.body = b; } }; } }),
			getNodeParameter: (name, dflt) => get(params, name, dflt),
			getBodyData: () => JSON.parse(rawBody.toString()),
			helpers: { returnJsonArray: (a) => a.map((json) => ({ json })) },
		};
		return { result: await new SendrailTrigger().webhook.call(ctx), sent };
	}
	let h = await hook({ events: ['message.final'], secret: 's3cret' }, raw, { 'x-sendrail-signature': sig });
	ok(h.result.workflowData[0][0].json.event === 'message.final' && h.result.workflowData[0][0].json.id === 'msg_1' && h.result.workflowData[0][0].json.status === 'sent', 'trigger: a signed event starts the workflow with the message flattened');
	h = await hook({ events: ['message.final'], secret: 's3cret' }, raw, { 'x-sendrail-signature': 'sha256=bad' });
	ok(h.sent.code === 401 && h.result.noWebhookResponse && !h.result.workflowData, 'trigger: a wrong signature is refused');
	h = await hook({ events: ['message.final'], secret: 's3cret' }, raw, {});
	ok(h.sent.code === 401, 'trigger: a missing signature is refused');
	h = await hook({ events: ['message.received'], secret: '' }, raw, {});
	ok(h.sent.code === 200 && h.sent.body.ignored && !h.result.workflowData, 'trigger: an event that was not chosen is acknowledged and ignored');
	const raw2 = Buffer.from('{"event":"message.received","data":{"id":812,"from":"+420777123456","message":"Yes"}}');
	h = await hook({ events: ['message.received'], secret: '' }, raw2, {});
	ok(h.result.workflowData[0][0].json.from === '+420777123456' && h.result.workflowData[0][0].json.event === 'message.received', 'trigger: a reply is passed on (no secret set)');

	console.log(`\nALL PASS (${passed})`);
})().catch((e) => { console.error('FAIL  ' + e.message); process.exit(1); });
