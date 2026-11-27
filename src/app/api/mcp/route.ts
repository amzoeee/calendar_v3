import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer } from '@/features/mcp/server';
import { authenticateMcpRequest } from '@/lib/mcp-tokens';

export const dynamic = 'force-dynamic';

// Stateless: every request gets a fresh server bound to the token's account,
// so nothing is kept between requests and any instance can answer.
async function handle(request: Request): Promise<Response> {
  const caller = await authenticateMcpRequest(request.headers.get('authorization'));
  if (!caller) {
    return Response.json(
      { error: 'Unauthorized. Create a token under Settings → MCP Server and send it as a Bearer token.' },
      { status: 401, headers: { 'www-authenticate': 'Bearer' } },
    );
  }

  const server = buildMcpServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
