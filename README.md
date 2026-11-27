# n8n-nodes-sendrail

n8n community node for [Sendrail](https://sendrail.cz), an SMS API with its own network of GSM gateways.

- **Sendrail** node: send SMS (text or stored template), send and check verification codes (OTP), check a phone number, manage the opt-out list, read replies, get the account's credit. Usable as a tool of an AI Agent node.
- **Sendrail Trigger** node: starts a workflow when a message reaches its final status, a reply or missed call arrives, or somebody opts out with STOP.

## Install

In n8n: **Settings → Community Nodes → Install**, package name `n8n-nodes-sendrail`. See the [n8n guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

Create an API key in the [Sendrail dashboard](https://sendrail.cz/app) under Keys and put it into a **Sendrail API** credential.

Start with a **test key** (`sr_test_…`, type "testovací" when creating the key): every operation works and answers the same, but nothing is sent and nothing is charged. A message becomes `sent` after about three seconds; a number ending in `0000` always fails, so you can try the error branch too.

## Operations

| Resource | Operation | |
|---|---|---|
| Message | Send | Text or stored template with variables. Options: idempotency key, dry run, bulk. |
| Message | Get, Cancel | Status of a message; cancel before it leaves. |
| Message | Get Many (inbound) | Latest replies and missed calls. Inbound must be switched on for the account. |
| Verification | Send, Check, Get | One-time code by SMS. `valid` is `true` exactly once. |
| Number | Check | Validity, country, kind and price without sending. Free. |
| Opt-Out | Get Many, Add, Remove | Numbers the account must not write to. |
| Account | Get | Credit, plan, limits and usage of the key. |

Tips:

- Set an **Idempotency Key** on Send (for example `order-{{ $json.orderId }}-ready`). When an execution is retried, the person does not get the text twice.
- Mass mailings (newsletters, campaigns) must have **Bulk** switched on.
- Check a verification code in the workflow; never send the code itself back to the person being verified.

## Trigger

1. In the Sendrail dashboard (sendrail.cz/app → Keys) tick **Povolit správu webhooku přes API** at the API key and save it. Without it the key cannot change its own webhook and activation fails with an error that says so.
2. Add **Sendrail Trigger**, pick the credential with that key, choose the events and activate the workflow. The node sets the key's webhook address itself and removes it when the workflow is deactivated.
3. Nothing to copy: the node reads the key's signing secret from Sendrail and refuses every request without a valid `X-Sendrail-Signature`.

A key has one webhook address. Use a separate key for each workflow with this trigger, and another key for "Listen for test event" – a test run points the key at the test address and clears it afterwards.

The output item has `event` and the fields of the message or event, for example `{"event": "message.final", "id": "msg_…", "status": "sent", …}`.

Sendrail repeats a delivery that was not acknowledged, so the same event can arrive more than once.

## Resources

- API documentation: <https://sendrail.cz/docs> (one Markdown file for models: <https://sendrail.cz/docs.md>)
- Ready workflows without this node (HTTP Request): <https://sendrail.cz/n8n>
- MCP server for AI agents: <https://sendrail.cz/ai>

## Development

```
npm install --ignore-scripts
npm test        # builds and runs test/smoke.js (no network)
```

## License

[MIT](LICENSE)
