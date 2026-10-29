import { Data } from 'effect';

export type McpTransportKind = 'stdio' | 'http';

export class McpConnectFailed extends Data.TaggedError('McpConnectFailed')<{
  readonly server: string;
  readonly transport: McpTransportKind;
  readonly reason: string;
  readonly stderr?: string;
}> {
  override get message(): string {
    const detail = this.stderr === undefined ? '' : `\n${this.stderr}`;
    return `MCP server ${this.server} could not connect over ${this.transport}: ${this.reason}${detail}`;
  }
}

export class McpCallFailed extends Data.TaggedError('McpCallFailed')<{
  readonly server: string;
  readonly tool: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `MCP server ${this.server} could not call ${this.tool}: ${this.reason}`;
  }
}

export class McpResourceFailed extends Data.TaggedError('McpResourceFailed')<{
  readonly server: string;
  readonly uri?: string;
  readonly method: 'resources/list' | 'resources/read' | 'resources/subscribe' | 'resources/unsubscribe';
  readonly reason: string;
}> {
  override get message(): string {
    const resource = this.uri === undefined ? '' : ` for ${this.uri}`;
    return `MCP server ${this.server} failed ${this.method}${resource}: ${this.reason}`;
  }
}

export class McpTimedOut extends Data.TaggedError('McpTimedOut')<{
  readonly server: string;
  readonly tool?: string;
  readonly ms: number;
}> {
  override get message(): string {
    const operation = this.tool === undefined ? 'connect' : `call ${this.tool}`;
    return `MCP server ${this.server} timed out during ${operation} after ${this.ms} ms.`;
  }
}

export class McpNotConnected extends Data.TaggedError('McpNotConnected')<{
  readonly server: string;
  readonly state: string;
}> {
  override get message(): string {
    return `MCP server ${this.server} is not connected; its state is ${this.state}.`;
  }
}

export class McpToolUnoffered extends Data.TaggedError('McpToolUnoffered')<{
  readonly server: string;
  readonly tool: string;
}> {
  override get message(): string {
    return `MCP server ${this.server} offers its app no tool named ${this.tool}.`;
  }
}

export class McpServerReplaced extends Data.TaggedError('McpServerReplaced')<{
  readonly server: string;
}> {
  override get message(): string {
    return `MCP server ${this.server} was declared again since its view opened, so the view no longer reaches the server it came from.`;
  }
}

export class McpNeedsSignIn extends Data.TaggedError('McpNeedsSignIn')<{
  readonly server: string;
  readonly scope?: string;
  readonly resourceMetadata?: string;
}> {
  override get message(): string {
    return this.scope === undefined
      ? `MCP server ${this.server} needs a sign-in.`
      : `MCP server ${this.server} needs a sign-in granting ${this.scope}.`;
  }
}

export type McpFailure = McpConnectFailed | McpCallFailed | McpTimedOut | McpNotConnected | McpNeedsSignIn;

export class McpServeFailed extends Data.TaggedError('McpServeFailed')<{
  readonly transport: McpTransportKind;
  readonly reason: string;
}> {
  override get message(): string {
    return `This process could not serve MCP over ${this.transport}: ${this.reason}`;
  }
}
