import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class SendrailApi implements ICredentialType {
	name = 'sendrailApi';

	displayName = 'Sendrail API';

	documentationUrl = 'https://sendrail.cz/docs';

	icon = 'file:sendrail.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Created in the Sendrail dashboard under API keys. A key starting with sr_test_ sends nothing and charges nothing; use it while building the workflow.',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.sendrail.cz',
			description: 'Change only if Sendrail support tells you to',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
	};

	test: ICredentialTestRequest = {
		request: { baseURL: '={{$credentials.baseUrl}}', url: '/v1/account' },
	};
}
