export type ExternalOperations = {
  readonly act_on_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly steps: readonly [{
        readonly action: 'click' | 'double-click' | 'hover' | 'fill' | 'type' | 'press' | 'select' | 'check' | 'uncheck' | 'scroll' | 'drag' | 'upload' | 'focus';
        /** An element reference a snapshot or a picked element answered, like `e12`. */
        readonly ref?: string;
        readonly x?: number;
        readonly y?: number;
        readonly text?: string;
        readonly key?: string;
        readonly values?: readonly string[];
        readonly to?: {
          readonly ref?: string;
          readonly x?: number;
          readonly y?: number;
        };
        readonly dx?: number;
        readonly dy?: number;
        readonly files?: readonly string[];
      }, ...({
        readonly action: 'click' | 'double-click' | 'hover' | 'fill' | 'type' | 'press' | 'select' | 'check' | 'uncheck' | 'scroll' | 'drag' | 'upload' | 'focus';
        readonly ref?: string;
        readonly x?: number;
        readonly y?: number;
        readonly text?: string;
        readonly key?: string;
        readonly values?: readonly string[];
        readonly to?: {
          readonly ref?: string;
          readonly x?: number;
          readonly y?: number;
        };
        readonly dx?: number;
        readonly dy?: number;
        readonly files?: readonly string[];
      })[]];
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly completed: number;
      readonly stopped: number | null;
      readonly status: 'acted';
    };
  };
  readonly answer_page_dialog: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly accept: boolean;
      readonly text?: string;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly status: 'answered';
    };
  };
  readonly answer_question: {
    readonly input: {
      readonly threadId: string;
      readonly questionId: string;
      readonly answers: readonly {
        readonly questionId: string;
        readonly values: readonly string[];
        readonly annotation?: {
          readonly notes?: string;
          readonly preview?: string;
        };
      }[];
      readonly key?: string;
    };
    readonly answer: {
      readonly runId: string;
      readonly status: 'started';
    } | {
      readonly runId: string;
      readonly status: 'already-running';
    };
  };
  readonly archive_thread: {
    readonly input: {
      readonly threadId: string;
      /** true — put away (the default); false — bring back what was put away with it. */
      readonly archived?: boolean;
    };
    readonly answer: {
      readonly threadId: string;
      readonly status: 'archived';
    } | {
      readonly threadId: string;
      readonly status: 'unarchived';
    };
  };
  readonly ask_model: {
    readonly input: {
      readonly prompt: string;
      readonly system?: string;
      readonly model?: {
        readonly provider: string;
        readonly model: string;
        readonly reasoning?: string | null;
      };
      readonly schema?: {
        readonly [key: string]: unknown;
      };
    };
    readonly answer: {
      readonly text: string;
      readonly status: 'text';
    } | {
      readonly value: unknown;
      readonly status: 'object';
    };
  };
  readonly audit_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      /** An element reference a snapshot or a picked element answered, like `e12`. */
      readonly within?: string;
      readonly tags?: readonly [string, ...string[]];
      /** How many rows to answer, 30 by default and 97 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly violations: readonly ({
        readonly rule: string;
        readonly impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
        /** What the rule requires, in one line. */
        readonly help: string;
        readonly url: string;
        /** The WCAG tags of the rule; empty for a best practice. */
        readonly wcag: readonly string[];
        /** How many nodes fail the rule; `nodes` lists the share the limit left it. */
        readonly failing: number;
        readonly nodes: readonly ({
          /** The reference act_on_page and snapshot_page take; null when the node left the page before the audit answered. */
          readonly ref: string | null;
          /** What fails on this node, as axe-core measured it. */
          readonly why: string;
          readonly html: string;
        })[];
      })[];
      readonly shown: number;
      /** Failing nodes across every rule. */
      readonly total: number;
      /** Nodes axe-core could not judge, which want a human look. */
      readonly incomplete: number;
      /** Rules every node passed. */
      readonly passed: number;
      /** Documents audited: the page and its frames. */
      readonly frames: number;
      /** Frames that could not be audited, by address. */
      readonly skipped: readonly string[];
      readonly status: 'audited';
    };
  };
  readonly call_contributed_tool: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The server as the plugin names it in mcpServers, without the `<plugin>-` prefix read_mcp_servers shows. */
      readonly server: string;
      readonly tool: string;
      readonly arguments: {
        readonly [key: string]: unknown;
      };
      /** The plugin whose view calls; a plugin’s process is its own caller and omits it. */
      readonly plugin?: string;
      /** The view that calls. */
      readonly view?: string;
      readonly threadId?: string;
    };
    readonly answer: {
      readonly result: {
        readonly content: readonly {
          readonly [key: string]: unknown;
        }[];
        readonly structuredContent?: {
          readonly [key: string]: unknown;
        };
        readonly isError?: boolean;
        readonly _meta?: {
          readonly [key: string]: unknown;
        };
      };
      readonly status: 'ok';
    };
  };
  readonly capture_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly what?: 'viewport' | 'full' | 'element' | 'pdf' | 'heap';
      /** An element reference a snapshot or a picked element answered, like `e12`. */
      readonly ref?: string;
      /** How many rows to answer, 20 by default and 105 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly path: string;
      readonly mediaType: string;
      readonly bytes: number;
      readonly width: number | null;
      readonly height: number | null;
      readonly status: 'captured';
    } | {
      readonly sizeBytes: number;
      readonly objectCount: number;
      readonly detachedNodes: number;
      readonly classes: readonly ({
        readonly name: string;
        readonly count: number;
        readonly sizeBytes: number;
        readonly countDelta: number | null;
        readonly sizeDelta: number | null;
      })[];
      readonly classCount: number;
      readonly growth: readonly ({
        readonly name: string;
        readonly count: number;
        readonly sizeBytes: number;
        readonly countDelta: number | null;
        readonly sizeDelta: number | null;
      })[];
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly path: string;
      readonly bytes: number;
      readonly pausedMs: number;
      readonly previous: string | null;
      readonly removed: readonly string[];
      readonly status: 'heap';
    };
  };
  readonly clear_profile: {
    readonly input: {
      /** The profile id list_profiles answered. */
      readonly profile: string;
    };
    readonly answer: {
      readonly profile: string;
      readonly pending: boolean;
      readonly status: 'cleared';
    };
  };
  readonly close_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
    };
    readonly answer: {
      readonly page: string;
      readonly status: 'closed';
    };
  };
  readonly continue_thread: {
    readonly input: {
      readonly threadId: string;
    };
    readonly answer: {
      readonly runId: string;
      readonly status: 'started';
    } | {
      readonly runId: string;
      readonly status: 'already-running';
    };
  };
  readonly create_profile: {
    readonly input: {
      /** The profile's name, at most 80 characters. */
      readonly name: string;
      readonly adapter: string;
      readonly document?: unknown;
      readonly console?: 'auto' | 'always' | 'never';
      readonly input?: 'human' | 'fast';
    };
    readonly answer: {
      readonly profile: {
        readonly id: string;
        readonly name: string;
        readonly adapter: string;
        /** `auto` captures console on loopback and private-network pages and on any page after its console is first read; `always` on every driven page; `never` refuses console reads. */
        readonly console: 'auto' | 'always' | 'never';
        readonly input: 'human' | 'fast';
        readonly connected: boolean;
        readonly removal: 'delete' | 'clear' | null;
        readonly createdAt: string;
      };
      readonly status: 'created';
    };
  };
  readonly create_thread: {
    readonly input: {
      readonly title?: string;
      readonly name?: string;
      readonly nameOrigin?: 'generated' | 'chosen';
      readonly type?: string;
      readonly host?: {
        readonly kind: string;
        readonly id: string;
      };
      readonly scopeName?: string;
      readonly account?: string;
      readonly switches?: {
        readonly [key: string]: string;
      };
      /** Keys an outside program files the thread under. `plugin` is Tagma’s own: written from the plugin that creates the thread, refused here. */
      readonly bindings?: {
        readonly [key: string]: string;
      };
      readonly approvalMode?: string;
      readonly delegation?: boolean;
      /** The thread’s own copy of the sub-agent team, as set_thread_team takes it; absent, it follows the project. */
      readonly team?: {
        readonly models: readonly ({
          readonly provider: string;
          readonly model: string;
          readonly reasoning: string | null;
          readonly open?: number;
          readonly depth?: number;
          readonly taste?: number;
          readonly ui?: number;
          readonly spend?: number;
          readonly favor?: number;
          readonly only?: readonly ('design' | 'implementation' | 'fix' | 'review' | 'research' | 'ui' | 'tests' | 'docs')[];
          readonly not?: readonly ('design' | 'implementation' | 'fix' | 'review' | 'research' | 'ui' | 'tests' | 'docs')[];
          readonly note?: string | null;
          readonly operatorOnly?: boolean;
          readonly on?: boolean;
          readonly reviews?: boolean;
          readonly removed?: boolean;
        } | {
          readonly provider: string;
          readonly on: boolean;
        })[];
        readonly review: {
          readonly reviewers: number;
          readonly lenses: readonly ('correctness' | 'architecture' | 'performance' | 'tests' | 'security' | 'ux')[];
        };
      };
      readonly parent?: never;
      readonly task?: string;
      /** A block of work the new thread takes in its own name at birth and opens its first turn on. */
      readonly work?: string;
      readonly worktree?: string;
      readonly base?: string;
      readonly worktreeName?: string;
    } | {
      readonly title?: never;
      readonly name?: string;
      readonly nameOrigin?: 'generated' | 'chosen';
      readonly type?: string;
      readonly host?: {
        readonly kind: string;
        readonly id: string;
      };
      readonly scopeName?: never;
      readonly account?: never;
      readonly switches?: never;
      readonly bindings?: {
        readonly [key: string]: string;
      };
      readonly approvalMode?: never;
      readonly delegation?: never;
      readonly team?: never;
      readonly parent: string;
      readonly task: string;
      readonly work?: never;
      readonly worktree?: never;
      readonly base?: never;
      readonly worktreeName?: never;
    };
    readonly answer: {
      readonly snapshot: {
        readonly thread: {
          readonly id: string;
          readonly ownerId: string;
          readonly agentId: string;
          readonly parentThreadId: string | null;
          readonly spawnedByRunId: string | null;
          readonly bornOf?: {
            readonly by: string;
            readonly step: number;
            readonly ask?: true;
          } | null;
          readonly spawnRootId: string;
          readonly name: string | null;
          readonly authority: {
            readonly mode: string;
            readonly bypassFrom: string | null;
          };
          readonly plain: boolean;
          readonly profile: {
            readonly id: string;
            readonly overlay: {
              readonly baseAgentId: string;
              readonly description: string;
              readonly instructions?: string;
              readonly tools?: readonly string[];
              readonly model?: {
                readonly provider?: string;
                readonly model?: string | null;
                readonly reasoning?: string | null;
              };
              readonly prompt?: string;
              readonly sections?: readonly ({
                readonly drop: string;
              } | {
                readonly keep: readonly string[];
              } | {
                readonly replace: string;
                readonly text: string;
              } | {
                readonly add: string;
                readonly before: string;
                readonly text: string;
              } | {
                readonly add: string;
                readonly after: string;
                readonly text: string;
              } | {
                readonly edit: string;
                readonly find: string;
                readonly with: string;
              })[];
              readonly capabilities?: readonly string[];
              readonly runtimeSources?: readonly string[];
              readonly audience?: string;
              readonly budget?: {
                readonly prompt?: number;
                readonly steps?: number;
                readonly seconds?: number;
              };
              readonly id: string;
            };
          } | null;
          readonly budgetTokens: number | null;
          readonly hostKind: string | null;
          readonly hostId: string | null;
          readonly account: string | null;
          readonly provider: string;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly transport: {
            readonly adapter: string;
            readonly profile: string | null;
            readonly agent: string | null;
          };
          readonly capabilities: {
            readonly messaging: boolean;
            readonly judgedModel: boolean;
            readonly steer: 'step' | 'none';
            readonly withdraw: boolean;
            readonly history: 'journal' | 'session' | 'none';
            readonly copies?: {
              readonly whole: 'vendor' | 'record' | 'none';
              readonly point: 'vendor' | 'record' | 'none';
            };
            readonly compaction: 'core' | 'session' | 'foreign' | 'vendor' | 'none';
            readonly toolCatalog?: 'turn' | 'dispatch';
            readonly modelMove: 'live' | 'relaunch' | 'pinned';
            readonly openings: 'core' | 'core-and-observed';
            readonly pictures: boolean;
            readonly web: 'vendor' | 'none';
            readonly law: 'every-call' | 'asked-calls' | null;
            readonly touch: 'reads-and-writes' | 'writes' | null;
            readonly authorship: 'recorded' | 'observed' | null;
            readonly callEnvelopeMs: number | null;
            readonly screen: boolean;
            readonly continue: boolean;
            readonly feed: 'full' | 'turns';
            readonly usage: 'measured' | 'partial' | 'none';
            readonly aside: 'request' | 'session' | 'none';
          };
          readonly unread?: readonly ('transport' | 'capabilities' | 'authority')[];
          readonly status: 'idle' | 'running' | 'failed';
          readonly failureReason: string | null;
          readonly contextReading: {
            readonly usage: {
              readonly inputTokens?: number;
              readonly outputTokens?: number;
              readonly nonCachedInputTokens?: number;
              readonly cacheReadInputTokens?: number;
              readonly cacheWriteInputTokens?: number;
              readonly reasoningTokens?: number;
              readonly totalTokens?: number;
              readonly providerMetadata?: {
                readonly [key: string]: {
                  readonly [key: string]: unknown;
                };
              };
            };
            readonly contextWindow: number | null;
            readonly inputLimit?: number | null;
            readonly footprint?: {
              readonly messages: number;
              readonly messageDigest: string;
              readonly promptDigest: string;
              readonly toolDigests: readonly string[];
            };
            readonly attempt?: number;
            readonly historyMessages?: number;
            readonly runId: string;
            readonly stepNumber: number;
            readonly provider: string | null;
            readonly model: string | null;
            readonly account?: string;
            readonly reasoning?: string | null;
            readonly measuredAt: string;
            readonly sentAt?: string;
            readonly cache?: {
              readonly ttlSeconds: number | null;
            };
            readonly stale: boolean;
            readonly staleBy?: 'rewind';
          } | null;
          readonly createdBy: string | null;
          readonly createdAt: string;
          readonly updatedAt: string;
          readonly projectId: number | null;
          readonly title: string;
          readonly parent?: {
            readonly id: string;
            readonly projectId: number;
            readonly title: string;
          };
          readonly detachedFrom?: {
            readonly id: string;
            readonly projectId: number;
            readonly title: string;
          };
          readonly cacheWarmth: {
            readonly state: 'warm' | 'likely' | 'cold' | 'unknown';
            readonly heldTokens: number | null;
            readonly basis: 'promise' | 'local' | 'prior' | 'none';
            readonly expiresAt: string | null;
            readonly gap: '<1m' | '1–5m' | '5–15m' | '15–30m' | '30–60m' | '1–2h' | '>2h' | null;
            readonly warmShare: number | null;
            readonly sample: number | null;
            readonly oldestAt: string | null;
            readonly invalidatedBy: 'compaction' | 'rewind' | 'selection' | 'account' | 'reasoning' | null;
          } | null;
          readonly harness: {
            readonly name: string;
            readonly presentation: {
              readonly label: string;
              readonly iconProvider: string | null;
              readonly mark: string | null;
              readonly install: string | null;
              readonly modelProvider: string | null;
              readonly terminal: boolean;
              readonly acp: boolean;
              readonly hosted: boolean;
              readonly sharedSessions: boolean;
            };
            readonly transport: 'terminal' | 'acp' | null;
            readonly agent: string | null;
            readonly provider: string;
            readonly capabilities: {
              readonly messaging: boolean;
              readonly judgedModel: boolean;
              readonly steer: 'step' | 'none';
              readonly withdraw: boolean;
              readonly history: 'journal' | 'session' | 'none';
              readonly copies?: {
                readonly whole: 'vendor' | 'record' | 'none';
                readonly point: 'vendor' | 'record' | 'none';
              };
              readonly compaction: 'core' | 'session' | 'foreign' | 'vendor' | 'none';
              readonly toolCatalog?: 'turn' | 'dispatch';
              readonly modelMove: 'live' | 'relaunch' | 'pinned';
              readonly openings: 'core' | 'core-and-observed';
              readonly pictures: boolean;
              readonly web: 'vendor' | 'none';
              readonly law: 'every-call' | 'asked-calls' | null;
              readonly touch: 'reads-and-writes' | 'writes' | null;
              readonly authorship: 'recorded' | 'observed' | null;
              readonly callEnvelopeMs: number | null;
              readonly screen: boolean;
              readonly continue: boolean;
              readonly feed: 'full' | 'turns';
              readonly usage: 'measured' | 'partial' | 'none';
              readonly aside: 'request' | 'session' | 'none';
            };
            readonly unread?: readonly ('transport' | 'capabilities' | 'authority')[];
            readonly model: string | null;
            readonly effort: string | null;
            readonly asked: {
              readonly model: string;
              readonly reasoning: string | null;
            } | null;
            readonly execution: {
              readonly execution: string;
              readonly incarnation: number;
            } | null;
            readonly process: {
              readonly id: string;
              readonly state: 'starting' | 'running' | 'stopping' | 'uncertain' | 'ended';
              readonly startedAt: string;
              readonly origin?: 'launched' | 'adopted';
              readonly failure?: string;
            } | null;
            readonly observation: {
              readonly binding: {
                readonly sessionId: string | null;
                readonly execution: {
                  readonly execution: string;
                  readonly incarnation: number;
                } | null;
                readonly rootKey: string | null;
                readonly workKey?: string;
              };
              readonly revision: number;
              readonly metadata: {
                readonly model: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
                readonly effort: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
                readonly title: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
              };
              readonly diagnostics: readonly ({
                readonly cause: 'session-ended' | 'session-stopping' | 'turn-mismatch' | 'stale-execution' | 'execution-unproven' | 'root-unproven' | 'work-unproven' | 'foreign-root' | 'stale-revision' | 'stale-evidence' | 'child-event' | 'question-standing' | 'answer-unread' | 'submit-unconfirmed' | 'cli-background' | 'words-unproven' | 'words-dropped' | 'history-seeded';
                readonly at: string;
                readonly detail: string;
              })[];
              readonly through?: string;
            };
          } | null;
          readonly cli: {
            readonly name: string;
            readonly presentation: {
              readonly label: string;
              readonly iconProvider: string | null;
              readonly mark: string | null;
              readonly install: string | null;
              readonly modelProvider: string | null;
              readonly terminal: boolean;
              readonly acp: boolean;
              readonly hosted: boolean;
              readonly sharedSessions: boolean;
            };
          } | null;
          readonly processAccount: string | null;
          readonly delegation: {
            readonly own: boolean | null;
            readonly allowed: boolean;
            readonly setAt: string | null;
          };
          readonly approving: {
            readonly approver: string | null;
            readonly why: 'taken-over' | 'parent' | 'no-grant' | 'no-parent';
            readonly takenOver: boolean;
            readonly approves: {
              readonly own: readonly string[] | null;
              readonly effective: readonly string[];
              readonly origin: 'own' | 'lineage' | 'setting';
              readonly setAt: string | null;
            };
          };
          readonly spawnDepth: {
            readonly current: number;
            readonly maximum: number;
            readonly remaining: number;
          };
          readonly place: {
            readonly rootId: string;
            readonly branch: string | null;
          } | null;
          readonly recap: {
            readonly summary: string;
            readonly next: string | null;
            readonly status: 'current' | 'stale' | 'void';
            readonly basis: {
              readonly position: number;
              readonly entryId: string;
              readonly runId: string;
              readonly journalHead: number;
              readonly generatedAt: string;
              readonly provider: string;
              readonly model: string;
            };
          } | null;
          readonly recapAttempt: {
            readonly state: 'writing';
            readonly entryId: string;
          } | {
            readonly state: 'refused';
            readonly entryId: string;
            readonly code: string;
            readonly reason: string;
            readonly unblock: readonly string[];
          } | null;
          readonly pins: readonly {
            readonly plugin: string;
            readonly view: string;
            readonly key: string;
          }[];
          readonly modes: readonly {
            readonly id: string;
            readonly label: string;
            readonly description: string;
            readonly icon: string;
            readonly strictness: number;
            readonly elevated?: true;
          }[];
        };
        readonly activeRun: {
          readonly id: string;
          readonly threadId: string;
          readonly status: 'running' | 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
          readonly kind: 'turn' | 'keep-warm' | 'compaction';
          readonly ownerId: string;
          readonly account: string | null;
          readonly provider: string | null;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly progress: {
            readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
            readonly message: string | null;
            readonly halt?: {
              readonly reason: string;
            };
            readonly phase?: {
              readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
              readonly since: number;
              readonly waiting?: {
                readonly reason: string;
                readonly place: string | null;
              };
            };
          };
          readonly usage: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly nonCachedInputTokens?: number;
            readonly cacheReadInputTokens?: number;
            readonly cacheWriteInputTokens?: number;
            readonly reasoningTokens?: number;
            readonly totalTokens?: number;
            readonly providerMetadata?: {
              readonly [key: string]: {
                readonly [key: string]: unknown;
              };
            };
          } | null;
          readonly failureReason: string | null;
          readonly failure: {
            readonly provider: string | null;
            readonly account: string | null;
            readonly stage: string;
            readonly type: string;
            readonly httpStatus?: number;
            readonly retryable: boolean | null;
            readonly modelStarted: boolean | null;
            readonly contextOverflow?: boolean;
            readonly detail?: string;
            readonly rateLimit?: {
              readonly retryAfterMs?: number;
              readonly limit?: {
                readonly [key: string]: string;
              };
              readonly remaining?: {
                readonly [key: string]: string;
              };
              readonly reset?: {
                readonly [key: string]: string;
              };
            };
            readonly reason?: {
              readonly family: 'invalid-request' | 'no-route' | 'auth' | 'rate-limit' | 'quota' | 'content-policy' | 'overloaded' | 'refused' | 'torn-stream' | 'non-json-answer' | 'socket-closed' | 'clean-eof-no-finish' | 'blank-error' | 'invalid-output' | 'stalled' | 'dns' | 'tls' | 'reset' | 'connect-timeout' | 'unknown';
              readonly status?: number;
              readonly upstreamRequestId?: string;
              readonly attempt?: number;
              readonly elapsedMs?: number;
              readonly bytesRead?: number;
              readonly lastEvent?: {
                readonly type?: string;
                readonly count: number;
              };
              readonly excerpt?: string;
              readonly idleMs?: number;
              readonly host?: string;
              readonly cause?: readonly {
                readonly tag: string;
                readonly message: string;
                readonly code?: string;
              }[];
              readonly kind?: string;
              readonly said?: string;
            };
            readonly retry?: {
              readonly stop: 'exhausted' | 'not-retryable';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
            } | {
              readonly stop: 'delay-limit';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
              readonly retryAfterMs: number;
              readonly ceilingMs: number;
            };
            readonly stack?: string;
            readonly record: {
              readonly threadId: string;
              readonly runId: string;
              readonly entryId: string;
            };
          } | null;
          readonly settledBy: 'reader' | 'parent' | 'agent' | 'model' | null;
          readonly settledNotification: {
            readonly id: string;
            readonly startedAt: string;
            readonly finishedAt: string | null;
            readonly phase: 'publication' | 'subscriber' | 'confirmation';
            readonly subscriber: string | null;
            readonly delivered: readonly string[];
            readonly exhaustedAt: string | null;
            readonly lastFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
            readonly observationFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
          } | null;
          readonly createdAt: string;
          readonly startedAt: string;
          readonly heartbeatAt: string;
          readonly finishedAt: string | null;
          readonly updatedAt: string;
        } | null;
        readonly latestRun: {
          readonly id: string;
          readonly threadId: string;
          readonly status: 'running' | 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
          readonly kind: 'turn' | 'keep-warm' | 'compaction';
          readonly ownerId: string;
          readonly account: string | null;
          readonly provider: string | null;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly progress: {
            readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
            readonly message: string | null;
            readonly halt?: {
              readonly reason: string;
            };
            readonly phase?: {
              readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
              readonly since: number;
              readonly waiting?: {
                readonly reason: string;
                readonly place: string | null;
              };
            };
          };
          readonly usage: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly nonCachedInputTokens?: number;
            readonly cacheReadInputTokens?: number;
            readonly cacheWriteInputTokens?: number;
            readonly reasoningTokens?: number;
            readonly totalTokens?: number;
            readonly providerMetadata?: {
              readonly [key: string]: {
                readonly [key: string]: unknown;
              };
            };
          } | null;
          readonly failureReason: string | null;
          readonly failure: {
            readonly provider: string | null;
            readonly account: string | null;
            readonly stage: string;
            readonly type: string;
            readonly httpStatus?: number;
            readonly retryable: boolean | null;
            readonly modelStarted: boolean | null;
            readonly contextOverflow?: boolean;
            readonly detail?: string;
            readonly rateLimit?: {
              readonly retryAfterMs?: number;
              readonly limit?: {
                readonly [key: string]: string;
              };
              readonly remaining?: {
                readonly [key: string]: string;
              };
              readonly reset?: {
                readonly [key: string]: string;
              };
            };
            readonly reason?: {
              readonly family: 'invalid-request' | 'no-route' | 'auth' | 'rate-limit' | 'quota' | 'content-policy' | 'overloaded' | 'refused' | 'torn-stream' | 'non-json-answer' | 'socket-closed' | 'clean-eof-no-finish' | 'blank-error' | 'invalid-output' | 'stalled' | 'dns' | 'tls' | 'reset' | 'connect-timeout' | 'unknown';
              readonly status?: number;
              readonly upstreamRequestId?: string;
              readonly attempt?: number;
              readonly elapsedMs?: number;
              readonly bytesRead?: number;
              readonly lastEvent?: {
                readonly type?: string;
                readonly count: number;
              };
              readonly excerpt?: string;
              readonly idleMs?: number;
              readonly host?: string;
              readonly cause?: readonly {
                readonly tag: string;
                readonly message: string;
                readonly code?: string;
              }[];
              readonly kind?: string;
              readonly said?: string;
            };
            readonly retry?: {
              readonly stop: 'exhausted' | 'not-retryable';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
            } | {
              readonly stop: 'delay-limit';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
              readonly retryAfterMs: number;
              readonly ceilingMs: number;
            };
            readonly stack?: string;
            readonly record: {
              readonly threadId: string;
              readonly runId: string;
              readonly entryId: string;
            };
          } | null;
          readonly settledBy: 'reader' | 'parent' | 'agent' | 'model' | null;
          readonly settledNotification: {
            readonly id: string;
            readonly startedAt: string;
            readonly finishedAt: string | null;
            readonly phase: 'publication' | 'subscriber' | 'confirmation';
            readonly subscriber: string | null;
            readonly delivered: readonly string[];
            readonly exhaustedAt: string | null;
            readonly lastFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
            readonly observationFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
          } | null;
          readonly createdAt: string;
          readonly startedAt: string;
          readonly heartbeatAt: string;
          readonly finishedAt: string | null;
          readonly updatedAt: string;
        } | null;
        readonly pendingInput: {
          readonly queued: readonly ({
            readonly id: string;
            readonly runId: string;
            readonly kind?: 'compaction';
            readonly text: string;
            readonly keep?: string;
            readonly summarizer?: {
              readonly provider: string;
              readonly model: string;
              readonly reasoning?: string | null;
            };
            readonly attachments?: readonly {
              readonly id: string;
              readonly mime: string;
              readonly url: string;
              readonly filename?: string;
            }[];
            readonly from?: string;
            readonly senderThreadId?: string;
            readonly senderProjectId?: number;
            readonly intent?: string;
            readonly notice?: {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'ran' | 'compacted' | 'cooled';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'model-changed';
              readonly from: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly to: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'tasks';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'deleted';
              readonly by: string;
              readonly at: string;
              readonly ended: {
                readonly run: boolean;
                readonly owed: boolean;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'call-ending';
              readonly runId: string;
              readonly toolCallId: string;
              readonly tool: string;
              readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
              readonly threads: readonly ({
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              })[];
              readonly guides?: readonly ({
                readonly text: string;
                readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
                readonly ruleId?: string;
                readonly state?: {
                  readonly [key: string]: unknown;
                };
                readonly batchKey?: string;
                readonly covers?: readonly string[];
                readonly retell?: false;
                readonly withholds?: readonly string[];
                readonly toolName?: string;
                readonly toolCallId?: string;
                readonly taskId?: string;
              })[];
            } | {
              readonly kind: 'command-ending';
              readonly execution: string;
              readonly incarnation: number;
              readonly label?: string;
              readonly command: string | null;
              readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
              readonly exit: {
                readonly kind: 'code';
                readonly code: number;
              } | {
                readonly kind: 'signal';
                readonly signal: string;
              } | null;
              readonly tail: string | null;
            } | {
              readonly kind: 'thread-event';
              readonly thread: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
              readonly wakes: boolean;
              readonly forOperator?: boolean;
            };
            readonly occurredAt: string;
          })[];
          readonly steers: readonly ({
            readonly id: string;
            readonly runId: string;
            readonly kind?: 'compaction';
            readonly text: string;
            readonly keep?: string;
            readonly summarizer?: {
              readonly provider: string;
              readonly model: string;
              readonly reasoning?: string | null;
            };
            readonly attachments?: readonly {
              readonly id: string;
              readonly mime: string;
              readonly url: string;
              readonly filename?: string;
            }[];
            readonly from?: string;
            readonly senderThreadId?: string;
            readonly senderProjectId?: number;
            readonly intent?: string;
            readonly notice?: {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'ran' | 'compacted' | 'cooled';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'model-changed';
              readonly from: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly to: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'tasks';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'deleted';
              readonly by: string;
              readonly at: string;
              readonly ended: {
                readonly run: boolean;
                readonly owed: boolean;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'call-ending';
              readonly runId: string;
              readonly toolCallId: string;
              readonly tool: string;
              readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
              readonly threads: readonly ({
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              })[];
              readonly guides?: readonly ({
                readonly text: string;
                readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
                readonly ruleId?: string;
                readonly state?: {
                  readonly [key: string]: unknown;
                };
                readonly batchKey?: string;
                readonly covers?: readonly string[];
                readonly retell?: false;
                readonly withholds?: readonly string[];
                readonly toolName?: string;
                readonly toolCallId?: string;
                readonly taskId?: string;
              })[];
            } | {
              readonly kind: 'command-ending';
              readonly execution: string;
              readonly incarnation: number;
              readonly label?: string;
              readonly command: string | null;
              readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
              readonly exit: {
                readonly kind: 'code';
                readonly code: number;
              } | {
                readonly kind: 'signal';
                readonly signal: string;
              } | null;
              readonly tail: string | null;
            } | {
              readonly kind: 'thread-event';
              readonly thread: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
              readonly wakes: boolean;
              readonly forOperator?: boolean;
            };
            readonly occurredAt: string;
          })[];
          readonly arrived?: readonly ({
            readonly type: 'signal';
            readonly id: string;
            readonly runId?: string;
            readonly signalType: string;
            readonly addressee: 'reader' | 'transport';
            readonly text: string;
            readonly title?: string;
            readonly senderThreadId?: string;
            readonly senderProjectId?: number;
            readonly notice?: {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'ran' | 'compacted' | 'cooled';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'model-changed';
              readonly from: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly to: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'tasks';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'deleted';
              readonly by: string;
              readonly at: string;
              readonly ended: {
                readonly run: boolean;
                readonly owed: boolean;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'call-ending';
              readonly runId: string;
              readonly toolCallId: string;
              readonly tool: string;
              readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
              readonly threads: readonly ({
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              })[];
              readonly guides?: readonly ({
                readonly text: string;
                readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
                readonly ruleId?: string;
                readonly state?: {
                  readonly [key: string]: unknown;
                };
                readonly batchKey?: string;
                readonly covers?: readonly string[];
                readonly retell?: false;
                readonly withholds?: readonly string[];
                readonly toolName?: string;
                readonly toolCallId?: string;
                readonly taskId?: string;
              })[];
            } | {
              readonly kind: 'command-ending';
              readonly execution: string;
              readonly incarnation: number;
              readonly label?: string;
              readonly command: string | null;
              readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
              readonly exit: {
                readonly kind: 'code';
                readonly code: number;
              } | {
                readonly kind: 'signal';
                readonly signal: string;
              } | null;
              readonly tail: string | null;
            } | {
              readonly kind: 'thread-event';
              readonly thread: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
              readonly wakes: boolean;
              readonly forOperator?: boolean;
            };
            readonly attachments?: readonly {
              readonly mime: string;
              readonly url: string;
              readonly filename?: string;
            }[];
            readonly unconfirmed?: true;
            readonly occurredAt?: string;
            readonly rewound?: {
              readonly by: string;
              readonly scope: 'from' | 'turn';
            };
          })[];
        };
        readonly status: {
          readonly threadId: string;
          readonly runId: string | null;
          readonly life: 'idle' | 'working' | 'awaiting' | 'stalled';
          readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
          readonly openQuestions: readonly string[];
          readonly since: string | null;
          readonly ownership?: 'held' | 'stale-evidence' | 'recovering';
          readonly halt?: {
            readonly reason: string;
          };
          readonly ending?: {
            readonly runId: string;
            readonly status: 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
            readonly stoppedBy: 'reader' | 'parent' | 'agent' | 'model' | null;
            readonly failureReason: string | null;
            readonly finishedAt: string;
            readonly notification: 'confirmed' | 'claimed' | 'retry-wait' | 'notification-exhausted';
            readonly words?: {
              readonly text: string;
              readonly attachments?: readonly {
                readonly mime: string;
                readonly url: string;
                readonly filename?: string;
              }[];
            };
          };
          readonly launchBlocked?: true;
          readonly wordsWait?: 'archived' | 'launch-refused' | 'words-unsettled' | 'composer-draft';
          readonly receipts: readonly ({
            readonly key: string;
            readonly status: 'queued' | 'steered';
            readonly runId: string;
            readonly itemId: string;
            readonly occurredAt: string;
          })[];
        };
        readonly now: string;
        readonly contextLimit: {
          readonly window: number;
          readonly compaction: {
            readonly at: number;
            readonly strategy: 'percent' | 'reserve-output';
            readonly share: number | null;
            readonly source: 'override' | 'row' | 'global';
          } | null;
        } | null;
        readonly transcript: readonly unknown[];
        readonly before: number | null;
        readonly open: readonly ({
          readonly entry: unknown;
          readonly from: number;
        } | unknown)[];
        readonly progress: {
          readonly phase: {
            readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
            readonly since: number;
            readonly waiting?: {
              readonly reason: string;
              readonly place: string | null;
            };
          } | null;
          readonly estimate: {
            readonly stepNumber: number;
            readonly tokens: number;
            readonly contextWindow: number | null;
          } | null;
        } | null;
      };
      readonly status: 'loaded';
    };
  };
  readonly delete_profile: {
    readonly input: {
      /** The profile id list_profiles answered. */
      readonly profile: string;
    };
    readonly answer: {
      readonly profile: string;
      readonly pending: boolean;
      readonly status: 'deleted';
    };
  };
  readonly delete_worktree: {
    readonly input: {
      /** The worktree, by the `rootId` its row in list_worktrees answers. */
      readonly rootId: string;
    };
    readonly answer: {
      readonly rootId: string;
      readonly name: string;
      readonly committed: {
        readonly commit: string;
        readonly paths: readonly string[];
        readonly holders: readonly string[];
      } | null;
      readonly removed: boolean;
      readonly threads: {
        readonly moved: readonly string[];
        readonly kept: readonly {
          readonly threadId: string;
          readonly reason: string;
        }[];
      };
      readonly ended: readonly ({
        readonly kind: 'terminal' | 'command';
        readonly execution: {
          readonly installation: string;
          readonly execution: string;
          readonly incarnation: number;
        };
        readonly program: string | null;
        readonly holder: string;
      })[];
      readonly branch: {
        readonly status: 'deleted';
        readonly name: string;
      } | {
        readonly status: 'kept';
        readonly name: string | null;
        readonly reason: string;
        readonly commits: readonly {
          readonly sha: string;
          readonly subject: string;
        }[];
      };
      readonly status: 'deleted';
    } | {
      readonly rootId: string;
      readonly name: string;
      readonly committed: {
        readonly commit: string;
        readonly paths: readonly string[];
        readonly holders: readonly string[];
      } | null;
      readonly removed: boolean;
      readonly threads: {
        readonly moved: readonly string[];
        readonly kept: readonly {
          readonly threadId: string;
          readonly reason: string;
        }[];
      };
      readonly ended: readonly ({
        readonly kind: 'terminal' | 'command';
        readonly execution: {
          readonly installation: string;
          readonly execution: string;
          readonly incarnation: number;
        };
        readonly program: string | null;
        readonly holder: string;
      })[];
      readonly branch: {
        readonly status: 'deleted';
        readonly name: string;
      } | {
        readonly status: 'kept';
        readonly name: string | null;
        readonly reason: string;
        readonly commits: readonly {
          readonly sha: string;
          readonly subject: string;
        }[];
      };
      readonly status: 'branch-kept';
    };
  };
  readonly emulate_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly viewport?: {
        readonly width: number;
        readonly height: number;
        readonly scale?: number;
        readonly mobile?: boolean;
      };
      readonly device?: 'iphone-15' | 'pixel-8' | 'ipad' | 'laptop';
      readonly scheme?: 'light' | 'dark';
      readonly cpu?: number;
      readonly network?: 'offline' | 'slow-3g' | 'fast-3g' | 'slow-4g' | 'fast-4g' | {
        /** Added latency in milliseconds. */
        readonly latency: number;
        /** Download throughput in bytes per second; -1 leaves it unlimited. */
        readonly download: number;
        /** Upload throughput in bytes per second; -1 leaves it unlimited. */
        readonly upload: number;
      } | null;
      readonly geolocation?: {
        readonly latitude: number;
        readonly longitude: number;
        readonly accuracy?: number;
      } | null;
      readonly conditions?: false;
      readonly clear?: boolean;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly emulation: {
        readonly viewport: {
          readonly width: number;
          readonly height: number;
          readonly scale?: number;
          readonly mobile?: boolean;
        } | null;
        readonly device: 'iphone-15' | 'pixel-8' | 'ipad' | 'laptop' | null;
        readonly scheme: 'light' | 'dark' | null;
        readonly cpu: number;
        readonly network: 'offline' | 'slow-3g' | 'fast-3g' | 'slow-4g' | 'fast-4g' | {
          /** Added latency in milliseconds. */
          readonly latency: number;
          /** Download throughput in bytes per second; -1 leaves it unlimited. */
          readonly download: number;
          /** Upload throughput in bytes per second; -1 leaves it unlimited. */
          readonly upload: number;
        } | null;
        readonly geolocation: {
          readonly latitude: number;
          readonly longitude: number;
          readonly accuracy?: number;
        } | null;
      };
      readonly status: 'emulated';
    };
  };
  readonly evaluate_in_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly expression: string;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly value: string;
      readonly cut: boolean;
      readonly status: 'evaluated';
    } | {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly exception: string;
      readonly status: 'thrown';
    };
  };
  readonly import_cookies: {
    readonly input: {
      /** The Tagma profile that receives the cookies, as list_profiles answered it. */
      readonly profile: string;
      /** A browser id list_cookie_sources answered. */
      readonly browser?: string;
      /** A profile id of that browser. */
      readonly browserProfile?: string;
      /** Another Tagma profile to copy the cookies of. */
      readonly from?: string;
      /** A JSON cookie file: absolute, or relative to the checkout this call stands in. */
      readonly file?: string;
    };
    readonly answer: {
      readonly profile: string;
      readonly written: number;
      readonly google: number;
      readonly unreadable: number;
      readonly rejected: number;
      readonly domains: readonly string[];
      readonly status: 'imported';
    };
  };
  readonly list_cookie_sources: {
    readonly input: {};
    readonly answer: {
      readonly browsers: readonly ({
        readonly id: string;
        readonly title: string;
        /** `keychain`: reading it asks macOS for the browser key, which the Tagma app reads; `full-disk`: it needs Full Disk Access. */
        readonly access: 'keychain' | 'full-disk' | null;
        readonly profiles: readonly {
          readonly id: string;
          readonly name: string;
        }[];
        readonly unreadable: string | null;
      })[];
      readonly profiles: readonly ({
        readonly id: string;
        readonly name: string;
        readonly adapter: string;
        /** `auto` captures console on loopback and private-network pages and on any page after its console is first read; `always` on every driven page; `never` refuses console reads. */
        readonly console: 'auto' | 'always' | 'never';
        readonly input: 'human' | 'fast';
        readonly connected: boolean;
        readonly removal: 'delete' | 'clear' | null;
        readonly createdAt: string;
      })[];
      readonly status: 'listed';
    };
  };
  readonly list_pages: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      readonly closed?: boolean;
      /** How many rows to answer, 20 by default and 72 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
      /** The cursor the previous page answered, handed back unchanged. */
      readonly cursor?: string;
    };
    readonly answer: {
      readonly pages: readonly ({
        readonly id: string;
        readonly projectId: number;
        readonly profile: string;
        readonly url: string;
        readonly title: string;
        readonly favicon: string | null;
        readonly openedBy: string | null;
        readonly opener: string | null;
        readonly state: 'live' | 'dormant' | 'away';
        /** The id of the connected host that holds the page now. */
        readonly host: string | null;
        readonly live: {
          readonly loading: boolean;
          readonly back: boolean;
          readonly forward: boolean;
          readonly crashed: boolean;
          readonly responsive: boolean;
          readonly dialog: {
            readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
            readonly message: string;
            readonly prompt: string | null;
            readonly url: string;
          } | null;
          readonly driven: string | null;
          readonly shown: boolean;
          readonly conditions: {
            readonly cpu: number;
            readonly network: 'offline' | 'slow-3g' | 'fast-3g' | 'slow-4g' | 'fast-4g' | {
              /** Added latency in milliseconds. */
              readonly latency: number;
              /** Download throughput in bytes per second; -1 leaves it unlimited. */
              readonly download: number;
              /** Upload throughput in bytes per second; -1 leaves it unlimited. */
              readonly upload: number;
            } | null;
            readonly geolocation: {
              readonly latitude: number;
              readonly longitude: number;
              readonly accuracy?: number;
            } | null;
          };
          readonly trace: {
            /** The thread that started it; null for the operator or an outside caller. */
            readonly by: string | null;
            readonly at: string;
          } | null;
          readonly recording: {
            readonly by: string | null;
            readonly at: string;
          } | null;
        };
        /** How many downloads the page keeps; read_page_downloads lists them. */
        readonly downloads: number;
        readonly activeAt: string;
        readonly closedAt: string | null;
      })[];
      readonly shown: number;
      readonly total: number;
      readonly next: string | null;
      readonly status: 'listed';
    };
  };
  readonly list_profiles: {
    readonly input: {};
    readonly answer: {
      readonly profiles: readonly ({
        readonly id: string;
        readonly name: string;
        readonly adapter: string;
        /** `auto` captures console on loopback and private-network pages and on any page after its console is first read; `always` on every driven page; `never` refuses console reads. */
        readonly console: 'auto' | 'always' | 'never';
        readonly input: 'human' | 'fast';
        readonly connected: boolean;
        readonly removal: 'delete' | 'clear' | null;
        readonly createdAt: string;
      })[];
      readonly status: 'listed';
    };
  };
  readonly navigate_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly url?: string;
      readonly go?: 'back' | 'forward' | 'reload' | 'stop';
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly status: 'navigated';
    };
  };
  readonly open_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The address to load; omitted, a blank page. */
      readonly url?: string;
      /** The profile id list_profiles answered. */
      readonly profile?: string;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly projectId: number;
        readonly profile: string;
        readonly url: string;
        readonly title: string;
        readonly favicon: string | null;
        readonly openedBy: string | null;
        readonly opener: string | null;
        readonly state: 'live' | 'dormant' | 'away';
        /** The id of the connected host that holds the page now. */
        readonly host: string | null;
        readonly live: {
          readonly loading: boolean;
          readonly back: boolean;
          readonly forward: boolean;
          readonly crashed: boolean;
          readonly responsive: boolean;
          readonly dialog: {
            readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
            readonly message: string;
            readonly prompt: string | null;
            readonly url: string;
          } | null;
          readonly driven: string | null;
          readonly shown: boolean;
          readonly conditions: {
            readonly cpu: number;
            readonly network: 'offline' | 'slow-3g' | 'fast-3g' | 'slow-4g' | 'fast-4g' | {
              /** Added latency in milliseconds. */
              readonly latency: number;
              /** Download throughput in bytes per second; -1 leaves it unlimited. */
              readonly download: number;
              /** Upload throughput in bytes per second; -1 leaves it unlimited. */
              readonly upload: number;
            } | null;
            readonly geolocation: {
              readonly latitude: number;
              readonly longitude: number;
              readonly accuracy?: number;
            } | null;
          };
          readonly trace: {
            /** The thread that started it; null for the operator or an outside caller. */
            readonly by: string | null;
            readonly at: string;
          } | null;
          readonly recording: {
            readonly by: string | null;
            readonly at: string;
          } | null;
        };
        /** How many downloads the page keeps; read_page_downloads lists them. */
        readonly downloads: number;
        readonly activeAt: string;
        readonly closedAt: string | null;
      };
      readonly status: 'opened';
    };
  };
  readonly pin_view: {
    readonly input: {
      readonly threadId: string;
      readonly plugin: string;
      readonly view: string;
      readonly key: string;
    };
    readonly answer: {
      readonly threadId: string;
      readonly plugin: string;
      readonly view: string;
      readonly key: string;
      readonly status: 'pinned';
    };
  };
  readonly queue_turn: {
    readonly input: {
      readonly threadId: string;
      readonly text?: string;
      readonly attachments?: readonly {
        readonly id: string;
      }[];
      readonly key: string;
    };
    readonly answer: {
      readonly runId: string;
      readonly acted: boolean;
      readonly status: 'started';
    } | {
      readonly runId: string;
      readonly itemId: string;
      readonly acted: boolean;
      readonly status: 'steered';
    } | {
      readonly runId: string;
      readonly queued: {
        readonly id: string;
        readonly runId: string;
        readonly kind?: 'compaction';
        readonly text: string;
        readonly keep?: string;
        readonly summarizer?: {
          readonly provider: string;
          readonly model: string;
          readonly reasoning?: string | null;
        };
        readonly attachments?: readonly {
          readonly id: string;
        }[];
        readonly from?: string;
        readonly senderThreadId?: string;
        readonly senderProjectId?: number;
        readonly intent?: string;
        readonly notice?: {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'ran' | 'compacted' | 'cooled';
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'model-changed';
          readonly from: {
            readonly provider: string;
            readonly model: string | null;
            readonly reasoning: string | null;
          };
          readonly to: {
            readonly provider: string;
            readonly model: string | null;
            readonly reasoning: string | null;
          };
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'tasks';
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'deleted';
          readonly by: string;
          readonly at: string;
          readonly ended: {
            readonly run: boolean;
            readonly owed: boolean;
          };
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'call-ending';
          readonly runId: string;
          readonly toolCallId: string;
          readonly tool: string;
          readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
          readonly threads: readonly ({
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          })[];
          readonly guides?: readonly ({
            readonly text: string;
            readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
            readonly ruleId?: string;
            readonly state?: {
              readonly [key: string]: unknown;
            };
            readonly batchKey?: string;
            readonly covers?: readonly string[];
            readonly retell?: false;
            readonly withholds?: readonly string[];
            readonly toolName?: string;
            readonly toolCallId?: string;
            readonly taskId?: string;
          })[];
        } | {
          readonly kind: 'command-ending';
          readonly execution: string;
          readonly incarnation: number;
          readonly label?: string;
          readonly command: string | null;
          readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
          readonly exit: {
            readonly kind: 'code';
            readonly code: number;
          } | {
            readonly kind: 'signal';
            readonly signal: string;
          } | null;
          readonly tail: string | null;
        } | {
          readonly kind: 'thread-event';
          readonly thread: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
          readonly wakes: boolean;
          readonly forOperator?: boolean;
        };
        readonly occurredAt: string;
      };
      readonly acted: boolean;
      readonly status: 'queued';
    };
  };
  readonly read_endings: {
    readonly input: {
      /** The threads whose endings to read, in the order to answer them. */
      readonly threads: readonly string[];
      /** How many endings each row carries, newest first (default 1, at most 3). */
      readonly depth?: number;
      /** The `cursor` the previous page answered; a changed set of threads refuses `cursor-stale`. */
      readonly cursor?: string;
      /** How many rows to answer, 10 by default and 33 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      readonly rows: readonly ({
        readonly threadId: string;
        readonly outcome: 'found';
        readonly endings: readonly ({
          readonly runId: string;
          readonly threadId: string;
          readonly status: 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
          readonly stoppedBy: 'reader' | 'parent' | 'agent' | 'model' | null;
          readonly failureReason: string | null;
          readonly finishedAt: string;
          readonly notification: {
            readonly state: 'confirmed' | 'claimed' | 'retry-wait' | 'notification-exhausted';
            readonly reclaims: number;
            readonly maxReclaims: number;
            readonly confirmedAt: string | null;
            readonly claimExpiresAt: string;
            readonly evidence: 'recorded' | 'unavailable';
            readonly attempt: {
              readonly id: string;
              readonly startedAt: string;
              readonly finishedAt: string | null;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly delivered: readonly string[];
              readonly exhaustedAt: string | null;
              readonly lastFailure: {
                readonly attemptId: string | null;
                readonly at: string;
                readonly phase: 'publication' | 'subscriber' | 'confirmation';
                readonly subscriber: string | null;
                readonly cause: readonly ({
                  readonly kind: 'failure' | 'defect' | 'interruption';
                  readonly tag: string | null;
                  readonly port: string | null;
                  readonly message: string;
                  readonly detail: string;
                  readonly fiberId: number | null;
                })[];
              } | null;
              readonly observationFailure: {
                readonly attemptId: string | null;
                readonly at: string;
                readonly phase: 'publication' | 'subscriber' | 'confirmation';
                readonly subscriber: string | null;
                readonly cause: readonly ({
                  readonly kind: 'failure' | 'defect' | 'interruption';
                  readonly tag: string | null;
                  readonly port: string | null;
                  readonly message: string;
                  readonly detail: string;
                  readonly fiberId: number | null;
                })[];
              } | null;
            } | null;
          };
        })[];
      } | {
        readonly threadId: string;
        readonly outcome: 'not-found' | 'foreign-project';
      })[];
      readonly total: number;
      readonly cursor: string | null;
      readonly status: 'ok';
    };
  };
  readonly read_model_menu: {
    readonly input: {};
    readonly answer: {
      readonly providers: readonly ({
        readonly id: string;
        readonly models: readonly ({
          readonly id: string;
          readonly reasoning: readonly string[];
          readonly operatorOnly: boolean;
          readonly lowered: readonly ({
            readonly rung: string;
            readonly to: string | null;
          })[];
          readonly switches: readonly ({
            readonly id: string;
            readonly label: string;
            readonly description: string;
            readonly values: readonly {
              readonly id: string;
              readonly label: string;
            }[];
            readonly default: string | null;
          })[];
        })[];
      })[];
      readonly status: 'read';
    };
  };
  readonly read_page_console: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly level?: 'error' | 'warning' | 'info' | 'log' | 'debug';
      readonly match?: string;
      readonly after?: number;
      /** How many rows to answer, 50 by default and 115 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
      /** Answer only the entry with this `seq`, whatever the filters. */
      readonly seq?: number;
      /** Add each entry's stack; such a read answers 10 rows by default and 36 at most. */
      readonly stack?: boolean;
    };
    readonly answer: {
      readonly page: string;
      readonly entries: readonly ({
        readonly seq: number;
        readonly level: 'error' | 'warning' | 'info' | 'log' | 'debug';
        readonly source: string;
        /** The console call that wrote it — log, table, trace, dir, startGroup, assert, count, timeEnd…; null for other sources. */
        readonly kind: string | null;
        readonly text: string;
        readonly url: string | null;
        readonly line: number | null;
        readonly at: string;
        /** Present when asked: the stack of the error it carries, else of the call, 10 frames at most; null when none was recorded. */
        readonly stack?: string | null;
      })[];
      readonly shown: number;
      readonly total: number;
      readonly dropped: number;
      readonly capturing: boolean;
      readonly conditions: string | null;
      readonly status: 'read';
    };
  };
  readonly read_page_downloads: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      /** How many rows to answer, 20 by default and 168 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      readonly page: string;
      readonly downloads: readonly ({
        readonly id: string;
        readonly name: string;
        readonly path: string | null;
        readonly bytes: number | null;
        readonly state: 'running' | 'done' | 'failed' | 'cancelled';
        readonly at: string;
      })[];
      readonly shown: number;
      readonly total: number;
      readonly conditions: string | null;
      readonly status: 'read';
    };
  };
  readonly read_page_network: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly match?: string;
      readonly failed?: boolean;
      readonly after?: number;
      /** How many rows to answer, 50 by default and 140 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
      readonly body?: string;
    };
    readonly answer: {
      readonly page: string;
      readonly requests: readonly ({
        readonly seq: number;
        readonly request: string;
        readonly method: string;
        readonly url: string;
        readonly type: string;
        readonly status: number | null;
        readonly mime: string | null;
        readonly bytes: number | null;
        readonly failure: string | null;
        readonly at: string;
        readonly ms: number | null;
      })[];
      readonly shown: number;
      readonly total: number;
      readonly dropped: number;
      readonly conditions: string | null;
      readonly status: 'read';
    } | {
      readonly page: string;
      readonly request: string;
      readonly body: string;
      readonly base64: boolean;
      readonly cut: boolean;
      readonly conditions: string | null;
      readonly status: 'body';
    };
  };
  readonly read_page_trace: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The trace id trace_page answered. */
      readonly trace: string;
      readonly set?: string;
      readonly insight?: 'LCPBreakdown' | 'INPBreakdown' | 'CLSCulprits' | 'DocumentLatency' | 'RenderBlocking' | 'LCPDiscovery' | 'NetworkDependencyTree' | 'ImageDelivery' | 'FontDisplay' | 'Viewport' | 'DOMSize' | 'ThirdParties' | 'DuplicatedJavaScript' | 'SlowCSSSelector' | 'ForcedReflow' | 'Cache' | 'CharacterSet' | 'ModernHTTP' | 'LegacyJavaScript';
      readonly hot?: boolean;
      /** How many rows to answer, 20 by default and 281 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      /** The trace id trace_page answered. */
      readonly trace: string;
      readonly path: string;
      readonly bytes: number;
      readonly durationMs: number;
      readonly conditions: string | null;
      /** Chromium reported dropping events: the trace buffer filled. */
      readonly dataLoss: boolean;
      /** For a load: whether the page reached its load event and a quiet with no request in flight before the deadline. */
      readonly settled: boolean | null;
      readonly sets: readonly ({
        /** NAVIGATION_<n> for a navigation, NO_NAVIGATION for the range before any. */
        readonly id: string;
        readonly url: string;
        /** Where the set starts, in milliseconds from the start of the trace. */
        readonly startMs: number;
        readonly durationMs: number;
        readonly lcp: {
          readonly ms: number;
          readonly element: string | null;
          readonly url: string | null;
          readonly phases: {
            readonly ttfb: number;
            readonly loadDelay: number | null;
            readonly loadDuration: number | null;
            readonly renderDelay: number;
          } | null;
        } | null;
        readonly inpMs: number | null;
        readonly cls: number | null;
        readonly failed: readonly ({
          readonly insight: 'LCPBreakdown' | 'INPBreakdown' | 'CLSCulprits' | 'DocumentLatency' | 'RenderBlocking' | 'LCPDiscovery' | 'NetworkDependencyTree' | 'ImageDelivery' | 'FontDisplay' | 'Viewport' | 'DOMSize' | 'ThirdParties' | 'DuplicatedJavaScript' | 'SlowCSSSelector' | 'ForcedReflow' | 'Cache' | 'CharacterSet' | 'ModernHTTP' | 'LegacyJavaScript';
          readonly line: string;
        })[];
      })[];
      /** How many insight sets the trace holds; the first twenty are kept and listed. */
      readonly setsTotal: number;
      readonly status: 'summary';
    } | {
      readonly trace: string;
      readonly set: string;
      readonly insight: 'LCPBreakdown' | 'INPBreakdown' | 'CLSCulprits' | 'DocumentLatency' | 'RenderBlocking' | 'LCPDiscovery' | 'NetworkDependencyTree' | 'ImageDelivery' | 'FontDisplay' | 'Viewport' | 'DOMSize' | 'ThirdParties' | 'DuplicatedJavaScript' | 'SlowCSSSelector' | 'ForcedReflow' | 'Cache' | 'CharacterSet' | 'ModernHTTP' | 'LegacyJavaScript';
      readonly state: 'pass' | 'fail' | 'informative';
      readonly line: string;
      readonly lines: readonly string[];
      readonly status: 'insight';
    } | {
      readonly trace: string;
      readonly set: string;
      readonly functions: readonly {
        readonly function: string;
        readonly url: string;
        /** 1-based; 0 when the engine knows no line. */
        readonly line: number;
        readonly selfMs: number;
        readonly totalMs: number;
      }[];
      readonly shown: number;
      readonly total: number;
      readonly status: 'hot';
    };
  };
  readonly read_statuses: {
    readonly input: {
      /** The threads to read, in the order to answer them. */
      readonly threads: readonly string[];
      /** The `cursor` the previous page answered; a changed set of threads refuses `cursor-stale`. */
      readonly cursor?: string;
      /** How many rows to answer, 50 by default and 50 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      readonly rows: readonly ({
        readonly threadId: string;
        readonly outcome: 'found';
        readonly status: {
          readonly threadId: string;
          readonly runId: string | null;
          readonly life: 'idle' | 'working' | 'awaiting' | 'stalled';
          readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
          readonly openQuestions: readonly string[];
          readonly since: string | null;
          readonly ownership?: 'held' | 'stale-evidence' | 'recovering';
          readonly halt?: {
            readonly reason: string;
          };
          readonly ending?: {
            readonly runId: string;
            readonly status: 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
            readonly stoppedBy: 'reader' | 'parent' | 'agent' | 'model' | null;
            readonly failureReason: string | null;
            readonly finishedAt: string;
            readonly notification: 'confirmed' | 'claimed' | 'retry-wait' | 'notification-exhausted';
            readonly words?: {
              readonly text: string;
              readonly attachments?: readonly {
                readonly mime: string;
                readonly url: string;
                readonly filename?: string;
              }[];
            };
          };
          readonly launchBlocked?: true;
          readonly wordsWait?: 'archived' | 'launch-refused' | 'words-unsettled' | 'composer-draft';
          readonly receipts: readonly ({
            readonly key: string;
            readonly status: 'queued' | 'steered';
            readonly runId: string;
            readonly itemId: string;
            readonly occurredAt: string;
          })[];
        };
      } | {
        readonly threadId: string;
        readonly outcome: 'not-found' | 'foreign-project';
      })[];
      readonly total: number;
      readonly cursor: string | null;
      readonly status: 'ok';
    };
  };
  readonly read_thread: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** One thread. Its shape, or the facts queried. */
      readonly threadId?: string;
      /** A set of threads to query across. Every one is admitted before any fact is answered. */
      readonly threads?: readonly string[];
      /** A set named the way list_threads names one, instead of by id. */
      readonly selection?: {
        /** Exactly these threads. */
        readonly ids?: readonly string[];
        /** The threads whose bindings name this plugin. Without `plugin` or `ids`, the general list leaves out the threads of every plugin that runs in their project and does not list its threads (`contributes.threads.listed`). */
        readonly plugin?: string;
        /** Part of the thread's title or of its agent's team name — either half of the list's `title (name)`. */
        readonly title?: string;
        /** The thread whose relations are selected. */
        readonly of?: string;
        readonly reach?: 'children' | 'descendants' | 'tree';
        readonly set?: 'live' | 'archived' | 'all';
        /** running: a run or a CLI session is going. stalled: a native run, not waiting on a question, with no durable movement for longer than the widest gap its bounds allow — its heartbeat proves only that its process lives. */
        readonly state?: 'running' | 'stalled';
        readonly models?: readonly string[];
        readonly providers?: readonly string[];
        /** An ISO instant, e.g. 2026-08-25T00:00:00Z. */
        readonly ranSince?: string;
        readonly ranBefore?: string;
        /** An activity of the thread opened at or after this instant: "what happened in this project in the last five minutes". */
        readonly activeSince?: string;
        readonly activeBefore?: string;
        readonly createdSince?: string;
        readonly createdBefore?: string;
        /** Durable movement at or after this instant — a turn, a run, a rename. */
        readonly updatedSince?: string;
        /** No durable movement since this instant: "idle for three days" is now minus three days here. */
        readonly updatedBefore?: string;
        readonly readerSince?: string;
        readonly readerBefore?: string;
        readonly archivedSince?: string;
        readonly archivedBefore?: string;
      };
      /** Which body of facts. Omit for the thread shape, or with a cursor to continue its saved question. */
      readonly select?: 'runs' | 'steps' | 'measurements' | 'entries' | 'records' | 'activity';
      readonly where?: readonly ({
        readonly field: string;
        readonly op: 'eq' | 'in' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
        readonly value?: unknown;
      })[];
      readonly fields?: readonly string[];
      readonly group?: readonly string[];
      readonly count?: boolean;
      readonly sum?: readonly string[];
      readonly order?: {
        readonly by: string;
        readonly dir: 'asc' | 'desc';
      };
      /** How many rows to answer with. An aggregate is not cut by it. */
      readonly limit?: number;
      readonly cursor?: string;
    };
    readonly answer: {
      readonly shape?: {
        readonly thread: {
          readonly id: string;
          readonly ownerId: string;
          readonly agentId: string;
          readonly parentThreadId: string | null;
          readonly spawnedByRunId: string | null;
          readonly bornOf?: {
            readonly by: string;
            readonly step: number;
            readonly ask?: true;
          } | null;
          readonly spawnRootId: string;
          readonly name: string | null;
          readonly authority: {
            readonly mode: string;
            readonly bypassFrom: string | null;
          };
          readonly plain: boolean;
          readonly profile: {
            readonly id: string;
            readonly overlay: {
              readonly baseAgentId: string;
              readonly description: string;
              readonly instructions?: string;
              readonly tools?: readonly string[];
              readonly model?: {
                readonly provider?: string;
                readonly model?: string | null;
                readonly reasoning?: string | null;
              };
              readonly prompt?: string;
              readonly sections?: readonly ({
                readonly drop: string;
              } | {
                readonly keep: readonly string[];
              } | {
                readonly replace: string;
                readonly text: string;
              } | {
                readonly add: string;
                readonly before: string;
                readonly text: string;
              } | {
                readonly add: string;
                readonly after: string;
                readonly text: string;
              } | {
                readonly edit: string;
                readonly find: string;
                readonly with: string;
              })[];
              readonly capabilities?: readonly string[];
              readonly runtimeSources?: readonly string[];
              readonly audience?: string;
              readonly budget?: {
                readonly prompt?: number;
                readonly steps?: number;
                readonly seconds?: number;
              };
              readonly id: string;
            };
          } | null;
          readonly budgetTokens: number | null;
          readonly hostKind: string | null;
          readonly hostId: string | null;
          readonly account: string | null;
          readonly provider: string;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly transport: {
            readonly adapter: string;
            readonly profile: string | null;
            readonly agent: string | null;
          };
          readonly capabilities: {
            readonly messaging: boolean;
            readonly judgedModel: boolean;
            readonly steer: 'step' | 'none';
            readonly withdraw: boolean;
            readonly history: 'journal' | 'session' | 'none';
            readonly copies?: {
              readonly whole: 'vendor' | 'record' | 'none';
              readonly point: 'vendor' | 'record' | 'none';
            };
            readonly compaction: 'core' | 'session' | 'foreign' | 'vendor' | 'none';
            readonly toolCatalog?: 'turn' | 'dispatch';
            readonly modelMove: 'live' | 'relaunch' | 'pinned';
            readonly openings: 'core' | 'core-and-observed';
            readonly pictures: boolean;
            readonly web: 'vendor' | 'none';
            readonly law: 'every-call' | 'asked-calls' | null;
            readonly touch: 'reads-and-writes' | 'writes' | null;
            readonly authorship: 'recorded' | 'observed' | null;
            readonly callEnvelopeMs: number | null;
            readonly screen: boolean;
            readonly continue: boolean;
            readonly feed: 'full' | 'turns';
            readonly usage: 'measured' | 'partial' | 'none';
            readonly aside: 'request' | 'session' | 'none';
          };
          readonly unread?: readonly ('transport' | 'capabilities' | 'authority')[];
          readonly status: 'idle' | 'running' | 'failed';
          readonly failureReason: string | null;
          readonly contextReading: {
            readonly usage: {
              readonly inputTokens?: number;
              readonly outputTokens?: number;
              readonly nonCachedInputTokens?: number;
              readonly cacheReadInputTokens?: number;
              readonly cacheWriteInputTokens?: number;
              readonly reasoningTokens?: number;
              readonly totalTokens?: number;
              readonly providerMetadata?: {
                readonly [key: string]: {
                  readonly [key: string]: unknown;
                };
              };
            };
            readonly contextWindow: number | null;
            readonly inputLimit?: number | null;
            readonly footprint?: {
              readonly messages: number;
              readonly messageDigest: string;
              readonly promptDigest: string;
              readonly toolDigests: readonly string[];
            };
            readonly attempt?: number;
            readonly historyMessages?: number;
            readonly runId: string;
            readonly stepNumber: number;
            readonly provider: string | null;
            readonly model: string | null;
            readonly account?: string;
            readonly reasoning?: string | null;
            readonly measuredAt: string;
            readonly sentAt?: string;
            readonly cache?: {
              readonly ttlSeconds: number | null;
            };
            readonly stale: boolean;
            readonly staleBy?: 'rewind';
          } | null;
          readonly createdBy: string | null;
          readonly createdAt: string;
          readonly updatedAt: string;
          readonly title: string;
          readonly projectId: number;
          readonly scope: string | null;
          readonly systemPrompt: string | null;
          readonly cacheWarmth: {
            readonly state: 'warm' | 'likely' | 'cold' | 'unknown';
            readonly heldTokens: number | null;
            readonly basis: 'promise' | 'local' | 'prior' | 'none';
            readonly expiresAt: string | null;
            readonly gap: '<1m' | '1–5m' | '5–15m' | '15–30m' | '30–60m' | '1–2h' | '>2h' | null;
            readonly warmShare: number | null;
            readonly sample: number | null;
            readonly oldestAt: string | null;
            readonly invalidatedBy: 'compaction' | 'rewind' | 'selection' | 'account' | 'reasoning' | null;
          } | null;
          readonly contextLimit: {
            readonly window: number;
            readonly compaction: {
              readonly at: number;
              readonly strategy: 'percent' | 'reserve-output';
              readonly share: number | null;
              readonly source: 'override' | 'row' | 'global';
            } | null;
          } | null;
          readonly harness: {
            readonly name: string;
            readonly presentation: {
              readonly label: string;
              readonly iconProvider: string | null;
              readonly mark: string | null;
              readonly install: string | null;
              readonly modelProvider: string | null;
              readonly terminal: boolean;
              readonly acp: boolean;
              readonly hosted: boolean;
              readonly sharedSessions: boolean;
            };
            readonly transport: 'terminal' | 'acp' | null;
            readonly agent: string | null;
            readonly provider: string;
            readonly capabilities: {
              readonly messaging: boolean;
              readonly judgedModel: boolean;
              readonly steer: 'step' | 'none';
              readonly withdraw: boolean;
              readonly history: 'journal' | 'session' | 'none';
              readonly copies?: {
                readonly whole: 'vendor' | 'record' | 'none';
                readonly point: 'vendor' | 'record' | 'none';
              };
              readonly compaction: 'core' | 'session' | 'foreign' | 'vendor' | 'none';
              readonly toolCatalog?: 'turn' | 'dispatch';
              readonly modelMove: 'live' | 'relaunch' | 'pinned';
              readonly openings: 'core' | 'core-and-observed';
              readonly pictures: boolean;
              readonly web: 'vendor' | 'none';
              readonly law: 'every-call' | 'asked-calls' | null;
              readonly touch: 'reads-and-writes' | 'writes' | null;
              readonly authorship: 'recorded' | 'observed' | null;
              readonly callEnvelopeMs: number | null;
              readonly screen: boolean;
              readonly continue: boolean;
              readonly feed: 'full' | 'turns';
              readonly usage: 'measured' | 'partial' | 'none';
              readonly aside: 'request' | 'session' | 'none';
            };
            readonly unread?: readonly ('transport' | 'capabilities' | 'authority')[];
            readonly model: string | null;
            readonly effort: string | null;
            readonly asked: {
              readonly model: string;
              readonly reasoning: string | null;
            } | null;
            readonly execution: {
              readonly execution: string;
              readonly incarnation: number;
            } | null;
            readonly process: {
              readonly id: string;
              readonly state: 'starting' | 'running' | 'stopping' | 'uncertain' | 'ended';
              readonly startedAt: string;
              readonly origin?: 'launched' | 'adopted';
              readonly failure?: string;
            } | null;
            readonly observation: {
              readonly binding: {
                readonly sessionId: string | null;
                readonly execution: {
                  readonly execution: string;
                  readonly incarnation: number;
                } | null;
                readonly rootKey: string | null;
                readonly workKey?: string;
              };
              readonly revision: number;
              readonly metadata: {
                readonly model: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
                readonly effort: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
                readonly title: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
              };
              readonly diagnostics: readonly ({
                readonly cause: 'session-ended' | 'session-stopping' | 'turn-mismatch' | 'stale-execution' | 'execution-unproven' | 'root-unproven' | 'work-unproven' | 'foreign-root' | 'stale-revision' | 'stale-evidence' | 'child-event' | 'question-standing' | 'answer-unread' | 'submit-unconfirmed' | 'cli-background' | 'words-unproven' | 'words-dropped' | 'history-seeded';
                readonly at: string;
                readonly detail: string;
              })[];
              readonly through?: string;
            };
          } | null;
        };
        readonly entries: number;
        readonly runs: readonly ({
          readonly id: string;
          readonly threadId: string;
          readonly status: 'running' | 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
          readonly kind: 'turn' | 'keep-warm' | 'compaction';
          readonly ownerId: string;
          readonly account: string | null;
          readonly provider: string | null;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly progress: {
            readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
            readonly message: string | null;
            readonly halt?: {
              readonly reason: string;
            };
            readonly phase?: {
              readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
              readonly since: number;
              readonly waiting?: {
                readonly reason: string;
                readonly place: string | null;
              };
            };
          };
          readonly usage: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly nonCachedInputTokens?: number;
            readonly cacheReadInputTokens?: number;
            readonly cacheWriteInputTokens?: number;
            readonly reasoningTokens?: number;
            readonly totalTokens?: number;
            readonly providerMetadata?: {
              readonly [key: string]: {
                readonly [key: string]: unknown;
              };
            };
          } | null;
          readonly failureReason: string | null;
          readonly failure: {
            readonly provider: string | null;
            readonly account: string | null;
            readonly stage: string;
            readonly type: string;
            readonly httpStatus?: number;
            readonly retryable: boolean | null;
            readonly modelStarted: boolean | null;
            readonly contextOverflow?: boolean;
            readonly detail?: string;
            readonly rateLimit?: {
              readonly retryAfterMs?: number;
              readonly limit?: {
                readonly [key: string]: string;
              };
              readonly remaining?: {
                readonly [key: string]: string;
              };
              readonly reset?: {
                readonly [key: string]: string;
              };
            };
            readonly reason?: {
              readonly family: 'invalid-request' | 'no-route' | 'auth' | 'rate-limit' | 'quota' | 'content-policy' | 'overloaded' | 'refused' | 'torn-stream' | 'non-json-answer' | 'socket-closed' | 'clean-eof-no-finish' | 'blank-error' | 'invalid-output' | 'stalled' | 'dns' | 'tls' | 'reset' | 'connect-timeout' | 'unknown';
              readonly status?: number;
              readonly upstreamRequestId?: string;
              readonly attempt?: number;
              readonly elapsedMs?: number;
              readonly bytesRead?: number;
              readonly lastEvent?: {
                readonly type?: string;
                readonly count: number;
              };
              readonly excerpt?: string;
              readonly idleMs?: number;
              readonly host?: string;
              readonly cause?: readonly {
                readonly tag: string;
                readonly message: string;
                readonly code?: string;
              }[];
              readonly kind?: string;
              readonly said?: string;
            };
            readonly retry?: {
              readonly stop: 'exhausted' | 'not-retryable';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
            } | {
              readonly stop: 'delay-limit';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
              readonly retryAfterMs: number;
              readonly ceilingMs: number;
            };
            readonly stack?: string;
            readonly record: {
              readonly threadId: string;
              readonly runId: string;
              readonly entryId: string;
            };
          } | null;
          readonly settledBy: 'reader' | 'parent' | 'agent' | 'model' | null;
          readonly settledNotification: {
            readonly id: string;
            readonly startedAt: string;
            readonly finishedAt: string | null;
            readonly phase: 'publication' | 'subscriber' | 'confirmation';
            readonly subscriber: string | null;
            readonly delivered: readonly string[];
            readonly exhaustedAt: string | null;
            readonly lastFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
            readonly observationFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
          } | null;
          readonly createdAt: string;
          readonly startedAt: string;
          readonly heartbeatAt: string;
          readonly finishedAt: string | null;
          readonly updatedAt: string;
          readonly notification: {
            readonly state: 'confirmed' | 'claimed' | 'retry-wait' | 'notification-exhausted';
            readonly reclaims: number;
            readonly maxReclaims: number;
            readonly confirmedAt: string | null;
            readonly claimExpiresAt: string;
            readonly evidence: 'recorded' | 'unavailable';
            readonly attempt: {
              readonly id: string;
              readonly startedAt: string;
              readonly finishedAt: string | null;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly delivered: readonly string[];
              readonly exhaustedAt: string | null;
              readonly lastFailure: {
                readonly attemptId: string | null;
                readonly at: string;
                readonly phase: 'publication' | 'subscriber' | 'confirmation';
                readonly subscriber: string | null;
                readonly cause: readonly ({
                  readonly kind: 'failure' | 'defect' | 'interruption';
                  readonly tag: string | null;
                  readonly port: string | null;
                  readonly message: string;
                  readonly detail: string;
                  readonly fiberId: number | null;
                })[];
              } | null;
              readonly observationFailure: {
                readonly attemptId: string | null;
                readonly at: string;
                readonly phase: 'publication' | 'subscriber' | 'confirmation';
                readonly subscriber: string | null;
                readonly cause: readonly ({
                  readonly kind: 'failure' | 'defect' | 'interruption';
                  readonly tag: string | null;
                  readonly port: string | null;
                  readonly message: string;
                  readonly detail: string;
                  readonly fiberId: number | null;
                })[];
              } | null;
            } | null;
          } | null;
        })[];
        readonly acts: {
          readonly name: string | null;
          readonly entries: number;
          readonly blocks: readonly string[];
          readonly bounded: boolean;
          readonly unread: readonly {
            readonly projectId: number;
            readonly root: string;
            readonly code: string;
            readonly reason: string;
          }[];
        };
        readonly recap?: {
          readonly summary: string;
          readonly next: string | null;
          readonly status: 'current' | 'stale' | 'void';
          readonly basis: {
            readonly position: number;
            readonly entryId: string;
            readonly runId: string;
            readonly journalHead: number;
            readonly generatedAt: string;
            readonly provider: string;
            readonly model: string;
          };
        };
      };
      readonly evidence?: {
        readonly select: 'runs' | 'steps' | 'measurements' | 'entries' | 'records' | 'activity';
        readonly threads: readonly {
          readonly threadId: string;
          readonly head: number;
        }[];
        readonly over: number;
        readonly rows: readonly {
          readonly [key: string]: any;
        }[];
        readonly groups?: readonly {
          readonly by: {
            readonly [key: string]: any;
          };
          readonly absent?: readonly string[];
          readonly count?: number;
          readonly sum?: {
            readonly [key: string]: number;
          };
          readonly unknown?: {
            readonly [key: string]: number;
          };
        }[];
        readonly coverage: {
          readonly complete: boolean;
          readonly unavailable: readonly string[];
          readonly truncated: boolean;
          readonly read: number;
          readonly cut?: 'read-ceiling';
          readonly lost?: readonly {
            readonly scope?: 'global';
            readonly unknown?: boolean;
            readonly cause: string;
            readonly facts: number;
            readonly bodies: number;
            readonly bytes: number;
          }[];
        };
        readonly cursor: string | null;
      };
      readonly status: 'ok';
    };
  };
  readonly record_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly action: 'start' | 'stop';
      /** For start: frames per second, at most 30. */
      readonly fps?: number;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      /** Where the video is written once the recording stops. */
      readonly path: string;
      readonly fps: number;
      readonly status: 'recording';
    } | {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      /** The MP4 file, H.264. */
      readonly path: string;
      readonly bytes: number;
      readonly durationMs: number;
      /** The frame width in the file: the stream’s size, which a smaller viewer of the page lowers. */
      readonly width: number;
      readonly height: number;
      readonly fps: number;
      readonly ending: {
        /** `session-ended`: the page closed or the browser lost its session. */
        readonly cause: 'stopped' | 'run-ended' | 'session-ended';
        /** The thread that stopped it or whose run ended; null for the operator, an outside caller or an ended session. */
        readonly by: string | null;
      };
      readonly status: 'recorded';
    };
  };
  readonly restart_thread: {
    readonly input: {
      readonly threadId: string;
    };
    readonly answer: {
      readonly stoppedRunId: string | null;
      readonly runId: string | null;
      readonly status: 'restarted';
    };
  };
  readonly send_notification: {
    readonly input: {
      /** What this is about, at most 120 characters. */
      readonly title: string;
      /** More words under the title, at most 480 characters. */
      readonly body?: string;
      readonly question?: {
        /** What the operator is asked, at most 240 characters. */
        readonly text: string;
        /** The answers the operator picks from, at most 4 different ones of at most 80 characters. Empty means a free-text answer. */
        readonly options: readonly string[];
      };
      /** The sender's own name for this notification, at most 200 characters. Sending the same key again returns the notification it first made instead of making another. */
      readonly key?: string;
    };
    readonly answer: {
      readonly id: string;
      readonly repeated: boolean;
      readonly status: 'sent';
    };
  };
  readonly set_thread_model: {
    readonly input: {
      readonly threadId: string;
      readonly provider: string;
      readonly model: string;
      readonly reasoning: string | null;
      readonly account?: string | null;
      readonly switches: {
        readonly [key: string]: string;
      };
    };
    readonly answer: {
      readonly snapshot: {
        readonly thread: {
          readonly id: string;
          readonly ownerId: string;
          readonly agentId: string;
          readonly parentThreadId: string | null;
          readonly spawnedByRunId: string | null;
          readonly bornOf?: {
            readonly by: string;
            readonly step: number;
            readonly ask?: true;
          } | null;
          readonly spawnRootId: string;
          readonly name: string | null;
          readonly authority: {
            readonly mode: string;
            readonly bypassFrom: string | null;
          };
          readonly plain: boolean;
          readonly profile: {
            readonly id: string;
            readonly overlay: {
              readonly baseAgentId: string;
              readonly description: string;
              readonly instructions?: string;
              readonly tools?: readonly string[];
              readonly model?: {
                readonly provider?: string;
                readonly model?: string | null;
                readonly reasoning?: string | null;
              };
              readonly prompt?: string;
              readonly sections?: readonly ({
                readonly drop: string;
              } | {
                readonly keep: readonly string[];
              } | {
                readonly replace: string;
                readonly text: string;
              } | {
                readonly add: string;
                readonly before: string;
                readonly text: string;
              } | {
                readonly add: string;
                readonly after: string;
                readonly text: string;
              } | {
                readonly edit: string;
                readonly find: string;
                readonly with: string;
              })[];
              readonly capabilities?: readonly string[];
              readonly runtimeSources?: readonly string[];
              readonly audience?: string;
              readonly budget?: {
                readonly prompt?: number;
                readonly steps?: number;
                readonly seconds?: number;
              };
              readonly id: string;
            };
          } | null;
          readonly budgetTokens: number | null;
          readonly hostKind: string | null;
          readonly hostId: string | null;
          readonly account: string | null;
          readonly provider: string;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly transport: {
            readonly adapter: string;
            readonly profile: string | null;
            readonly agent: string | null;
          };
          readonly capabilities: {
            readonly messaging: boolean;
            readonly judgedModel: boolean;
            readonly steer: 'step' | 'none';
            readonly withdraw: boolean;
            readonly history: 'journal' | 'session' | 'none';
            readonly copies?: {
              readonly whole: 'vendor' | 'record' | 'none';
              readonly point: 'vendor' | 'record' | 'none';
            };
            readonly compaction: 'core' | 'session' | 'foreign' | 'vendor' | 'none';
            readonly toolCatalog?: 'turn' | 'dispatch';
            readonly modelMove: 'live' | 'relaunch' | 'pinned';
            readonly openings: 'core' | 'core-and-observed';
            readonly pictures: boolean;
            readonly web: 'vendor' | 'none';
            readonly law: 'every-call' | 'asked-calls' | null;
            readonly touch: 'reads-and-writes' | 'writes' | null;
            readonly authorship: 'recorded' | 'observed' | null;
            readonly callEnvelopeMs: number | null;
            readonly screen: boolean;
            readonly continue: boolean;
            readonly feed: 'full' | 'turns';
            readonly usage: 'measured' | 'partial' | 'none';
            readonly aside: 'request' | 'session' | 'none';
          };
          readonly unread?: readonly ('transport' | 'capabilities' | 'authority')[];
          readonly status: 'idle' | 'running' | 'failed';
          readonly failureReason: string | null;
          readonly contextReading: {
            readonly usage: {
              readonly inputTokens?: number;
              readonly outputTokens?: number;
              readonly nonCachedInputTokens?: number;
              readonly cacheReadInputTokens?: number;
              readonly cacheWriteInputTokens?: number;
              readonly reasoningTokens?: number;
              readonly totalTokens?: number;
              readonly providerMetadata?: {
                readonly [key: string]: {
                  readonly [key: string]: unknown;
                };
              };
            };
            readonly contextWindow: number | null;
            readonly inputLimit?: number | null;
            readonly footprint?: {
              readonly messages: number;
              readonly messageDigest: string;
              readonly promptDigest: string;
              readonly toolDigests: readonly string[];
            };
            readonly attempt?: number;
            readonly historyMessages?: number;
            readonly runId: string;
            readonly stepNumber: number;
            readonly provider: string | null;
            readonly model: string | null;
            readonly account?: string;
            readonly reasoning?: string | null;
            readonly measuredAt: string;
            readonly sentAt?: string;
            readonly cache?: {
              readonly ttlSeconds: number | null;
            };
            readonly stale: boolean;
            readonly staleBy?: 'rewind';
          } | null;
          readonly createdBy: string | null;
          readonly createdAt: string;
          readonly updatedAt: string;
          readonly projectId: number | null;
          readonly title: string;
          readonly parent?: {
            readonly id: string;
            readonly projectId: number;
            readonly title: string;
          };
          readonly detachedFrom?: {
            readonly id: string;
            readonly projectId: number;
            readonly title: string;
          };
          readonly cacheWarmth: {
            readonly state: 'warm' | 'likely' | 'cold' | 'unknown';
            readonly heldTokens: number | null;
            readonly basis: 'promise' | 'local' | 'prior' | 'none';
            readonly expiresAt: string | null;
            readonly gap: '<1m' | '1–5m' | '5–15m' | '15–30m' | '30–60m' | '1–2h' | '>2h' | null;
            readonly warmShare: number | null;
            readonly sample: number | null;
            readonly oldestAt: string | null;
            readonly invalidatedBy: 'compaction' | 'rewind' | 'selection' | 'account' | 'reasoning' | null;
          } | null;
          readonly harness: {
            readonly name: string;
            readonly presentation: {
              readonly label: string;
              readonly iconProvider: string | null;
              readonly mark: string | null;
              readonly install: string | null;
              readonly modelProvider: string | null;
              readonly terminal: boolean;
              readonly acp: boolean;
              readonly hosted: boolean;
              readonly sharedSessions: boolean;
            };
            readonly transport: 'terminal' | 'acp' | null;
            readonly agent: string | null;
            readonly provider: string;
            readonly capabilities: {
              readonly messaging: boolean;
              readonly judgedModel: boolean;
              readonly steer: 'step' | 'none';
              readonly withdraw: boolean;
              readonly history: 'journal' | 'session' | 'none';
              readonly copies?: {
                readonly whole: 'vendor' | 'record' | 'none';
                readonly point: 'vendor' | 'record' | 'none';
              };
              readonly compaction: 'core' | 'session' | 'foreign' | 'vendor' | 'none';
              readonly toolCatalog?: 'turn' | 'dispatch';
              readonly modelMove: 'live' | 'relaunch' | 'pinned';
              readonly openings: 'core' | 'core-and-observed';
              readonly pictures: boolean;
              readonly web: 'vendor' | 'none';
              readonly law: 'every-call' | 'asked-calls' | null;
              readonly touch: 'reads-and-writes' | 'writes' | null;
              readonly authorship: 'recorded' | 'observed' | null;
              readonly callEnvelopeMs: number | null;
              readonly screen: boolean;
              readonly continue: boolean;
              readonly feed: 'full' | 'turns';
              readonly usage: 'measured' | 'partial' | 'none';
              readonly aside: 'request' | 'session' | 'none';
            };
            readonly unread?: readonly ('transport' | 'capabilities' | 'authority')[];
            readonly model: string | null;
            readonly effort: string | null;
            readonly asked: {
              readonly model: string;
              readonly reasoning: string | null;
            } | null;
            readonly execution: {
              readonly execution: string;
              readonly incarnation: number;
            } | null;
            readonly process: {
              readonly id: string;
              readonly state: 'starting' | 'running' | 'stopping' | 'uncertain' | 'ended';
              readonly startedAt: string;
              readonly origin?: 'launched' | 'adopted';
              readonly failure?: string;
            } | null;
            readonly observation: {
              readonly binding: {
                readonly sessionId: string | null;
                readonly execution: {
                  readonly execution: string;
                  readonly incarnation: number;
                } | null;
                readonly rootKey: string | null;
                readonly workKey?: string;
              };
              readonly revision: number;
              readonly metadata: {
                readonly model: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
                readonly effort: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
                readonly title: {
                  readonly _tag: 'NotRead';
                } | {
                  readonly _tag: 'Value';
                  readonly value: string;
                  readonly claim: 'configured' | 'serving' | 'last-recorded';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Absent';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unsupported';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                } | {
                  readonly _tag: 'Unreadable';
                  readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol';
                  readonly scope: {
                    readonly rootKey: string | null;
                    readonly turnId: string | null;
                  };
                  readonly observedAt: string;
                  readonly reason: string;
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  } | null;
                } | {
                  readonly _tag: 'Stale';
                  readonly lastKnown: {
                    readonly value: string;
                    readonly claim: 'configured' | 'serving' | 'last-recorded' | null;
                    readonly source: 'hook' | 'vendor-record' | 'transcript' | 'session-store' | 'terminal' | 'protocol' | null;
                    readonly scope: {
                      readonly rootKey: string | null;
                      readonly turnId: string | null;
                    } | null;
                    readonly observedAt: string | null;
                    readonly why: 'unproven-source' | 'refused-evidence' | 'authority-lapsed' | 'refresh-failed';
                  };
                };
              };
              readonly diagnostics: readonly ({
                readonly cause: 'session-ended' | 'session-stopping' | 'turn-mismatch' | 'stale-execution' | 'execution-unproven' | 'root-unproven' | 'work-unproven' | 'foreign-root' | 'stale-revision' | 'stale-evidence' | 'child-event' | 'question-standing' | 'answer-unread' | 'submit-unconfirmed' | 'cli-background' | 'words-unproven' | 'words-dropped' | 'history-seeded';
                readonly at: string;
                readonly detail: string;
              })[];
              readonly through?: string;
            };
          } | null;
          readonly cli: {
            readonly name: string;
            readonly presentation: {
              readonly label: string;
              readonly iconProvider: string | null;
              readonly mark: string | null;
              readonly install: string | null;
              readonly modelProvider: string | null;
              readonly terminal: boolean;
              readonly acp: boolean;
              readonly hosted: boolean;
              readonly sharedSessions: boolean;
            };
          } | null;
          readonly processAccount: string | null;
          readonly delegation: {
            readonly own: boolean | null;
            readonly allowed: boolean;
            readonly setAt: string | null;
          };
          readonly approving: {
            readonly approver: string | null;
            readonly why: 'taken-over' | 'parent' | 'no-grant' | 'no-parent';
            readonly takenOver: boolean;
            readonly approves: {
              readonly own: readonly string[] | null;
              readonly effective: readonly string[];
              readonly origin: 'own' | 'lineage' | 'setting';
              readonly setAt: string | null;
            };
          };
          readonly spawnDepth: {
            readonly current: number;
            readonly maximum: number;
            readonly remaining: number;
          };
          readonly place: {
            readonly rootId: string;
            readonly branch: string | null;
          } | null;
          readonly recap: {
            readonly summary: string;
            readonly next: string | null;
            readonly status: 'current' | 'stale' | 'void';
            readonly basis: {
              readonly position: number;
              readonly entryId: string;
              readonly runId: string;
              readonly journalHead: number;
              readonly generatedAt: string;
              readonly provider: string;
              readonly model: string;
            };
          } | null;
          readonly recapAttempt: {
            readonly state: 'writing';
            readonly entryId: string;
          } | {
            readonly state: 'refused';
            readonly entryId: string;
            readonly code: string;
            readonly reason: string;
            readonly unblock: readonly string[];
          } | null;
          readonly pins: readonly {
            readonly plugin: string;
            readonly view: string;
            readonly key: string;
          }[];
          readonly modes: readonly {
            readonly id: string;
            readonly label: string;
            readonly description: string;
            readonly icon: string;
            readonly strictness: number;
            readonly elevated?: true;
          }[];
        };
        readonly activeRun: {
          readonly id: string;
          readonly threadId: string;
          readonly status: 'running' | 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
          readonly kind: 'turn' | 'keep-warm' | 'compaction';
          readonly ownerId: string;
          readonly account: string | null;
          readonly provider: string | null;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly progress: {
            readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
            readonly message: string | null;
            readonly halt?: {
              readonly reason: string;
            };
            readonly phase?: {
              readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
              readonly since: number;
              readonly waiting?: {
                readonly reason: string;
                readonly place: string | null;
              };
            };
          };
          readonly usage: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly nonCachedInputTokens?: number;
            readonly cacheReadInputTokens?: number;
            readonly cacheWriteInputTokens?: number;
            readonly reasoningTokens?: number;
            readonly totalTokens?: number;
            readonly providerMetadata?: {
              readonly [key: string]: {
                readonly [key: string]: unknown;
              };
            };
          } | null;
          readonly failureReason: string | null;
          readonly failure: {
            readonly provider: string | null;
            readonly account: string | null;
            readonly stage: string;
            readonly type: string;
            readonly httpStatus?: number;
            readonly retryable: boolean | null;
            readonly modelStarted: boolean | null;
            readonly contextOverflow?: boolean;
            readonly detail?: string;
            readonly rateLimit?: {
              readonly retryAfterMs?: number;
              readonly limit?: {
                readonly [key: string]: string;
              };
              readonly remaining?: {
                readonly [key: string]: string;
              };
              readonly reset?: {
                readonly [key: string]: string;
              };
            };
            readonly reason?: {
              readonly family: 'invalid-request' | 'no-route' | 'auth' | 'rate-limit' | 'quota' | 'content-policy' | 'overloaded' | 'refused' | 'torn-stream' | 'non-json-answer' | 'socket-closed' | 'clean-eof-no-finish' | 'blank-error' | 'invalid-output' | 'stalled' | 'dns' | 'tls' | 'reset' | 'connect-timeout' | 'unknown';
              readonly status?: number;
              readonly upstreamRequestId?: string;
              readonly attempt?: number;
              readonly elapsedMs?: number;
              readonly bytesRead?: number;
              readonly lastEvent?: {
                readonly type?: string;
                readonly count: number;
              };
              readonly excerpt?: string;
              readonly idleMs?: number;
              readonly host?: string;
              readonly cause?: readonly {
                readonly tag: string;
                readonly message: string;
                readonly code?: string;
              }[];
              readonly kind?: string;
              readonly said?: string;
            };
            readonly retry?: {
              readonly stop: 'exhausted' | 'not-retryable';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
            } | {
              readonly stop: 'delay-limit';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
              readonly retryAfterMs: number;
              readonly ceilingMs: number;
            };
            readonly stack?: string;
            readonly record: {
              readonly threadId: string;
              readonly runId: string;
              readonly entryId: string;
            };
          } | null;
          readonly settledBy: 'reader' | 'parent' | 'agent' | 'model' | null;
          readonly settledNotification: {
            readonly id: string;
            readonly startedAt: string;
            readonly finishedAt: string | null;
            readonly phase: 'publication' | 'subscriber' | 'confirmation';
            readonly subscriber: string | null;
            readonly delivered: readonly string[];
            readonly exhaustedAt: string | null;
            readonly lastFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
            readonly observationFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
          } | null;
          readonly createdAt: string;
          readonly startedAt: string;
          readonly heartbeatAt: string;
          readonly finishedAt: string | null;
          readonly updatedAt: string;
        } | null;
        readonly latestRun: {
          readonly id: string;
          readonly threadId: string;
          readonly status: 'running' | 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
          readonly kind: 'turn' | 'keep-warm' | 'compaction';
          readonly ownerId: string;
          readonly account: string | null;
          readonly provider: string | null;
          readonly model: string | null;
          readonly reasoning: string | null;
          readonly switches: {
            readonly [key: string]: string;
          };
          readonly progress: {
            readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
            readonly message: string | null;
            readonly halt?: {
              readonly reason: string;
            };
            readonly phase?: {
              readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
              readonly since: number;
              readonly waiting?: {
                readonly reason: string;
                readonly place: string | null;
              };
            };
          };
          readonly usage: {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly nonCachedInputTokens?: number;
            readonly cacheReadInputTokens?: number;
            readonly cacheWriteInputTokens?: number;
            readonly reasoningTokens?: number;
            readonly totalTokens?: number;
            readonly providerMetadata?: {
              readonly [key: string]: {
                readonly [key: string]: unknown;
              };
            };
          } | null;
          readonly failureReason: string | null;
          readonly failure: {
            readonly provider: string | null;
            readonly account: string | null;
            readonly stage: string;
            readonly type: string;
            readonly httpStatus?: number;
            readonly retryable: boolean | null;
            readonly modelStarted: boolean | null;
            readonly contextOverflow?: boolean;
            readonly detail?: string;
            readonly rateLimit?: {
              readonly retryAfterMs?: number;
              readonly limit?: {
                readonly [key: string]: string;
              };
              readonly remaining?: {
                readonly [key: string]: string;
              };
              readonly reset?: {
                readonly [key: string]: string;
              };
            };
            readonly reason?: {
              readonly family: 'invalid-request' | 'no-route' | 'auth' | 'rate-limit' | 'quota' | 'content-policy' | 'overloaded' | 'refused' | 'torn-stream' | 'non-json-answer' | 'socket-closed' | 'clean-eof-no-finish' | 'blank-error' | 'invalid-output' | 'stalled' | 'dns' | 'tls' | 'reset' | 'connect-timeout' | 'unknown';
              readonly status?: number;
              readonly upstreamRequestId?: string;
              readonly attempt?: number;
              readonly elapsedMs?: number;
              readonly bytesRead?: number;
              readonly lastEvent?: {
                readonly type?: string;
                readonly count: number;
              };
              readonly excerpt?: string;
              readonly idleMs?: number;
              readonly host?: string;
              readonly cause?: readonly {
                readonly tag: string;
                readonly message: string;
                readonly code?: string;
              }[];
              readonly kind?: string;
              readonly said?: string;
            };
            readonly retry?: {
              readonly stop: 'exhausted' | 'not-retryable';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
            } | {
              readonly stop: 'delay-limit';
              readonly attempts: number;
              readonly retries: number;
              readonly limit: number;
              readonly retryAfterMs: number;
              readonly ceilingMs: number;
            };
            readonly stack?: string;
            readonly record: {
              readonly threadId: string;
              readonly runId: string;
              readonly entryId: string;
            };
          } | null;
          readonly settledBy: 'reader' | 'parent' | 'agent' | 'model' | null;
          readonly settledNotification: {
            readonly id: string;
            readonly startedAt: string;
            readonly finishedAt: string | null;
            readonly phase: 'publication' | 'subscriber' | 'confirmation';
            readonly subscriber: string | null;
            readonly delivered: readonly string[];
            readonly exhaustedAt: string | null;
            readonly lastFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
            readonly observationFailure: {
              readonly attemptId: string | null;
              readonly at: string;
              readonly phase: 'publication' | 'subscriber' | 'confirmation';
              readonly subscriber: string | null;
              readonly cause: readonly ({
                readonly kind: 'failure' | 'defect' | 'interruption';
                readonly tag: string | null;
                readonly port: string | null;
                readonly message: string;
                readonly detail: string;
                readonly fiberId: number | null;
              })[];
            } | null;
          } | null;
          readonly createdAt: string;
          readonly startedAt: string;
          readonly heartbeatAt: string;
          readonly finishedAt: string | null;
          readonly updatedAt: string;
        } | null;
        readonly pendingInput: {
          readonly queued: readonly ({
            readonly id: string;
            readonly runId: string;
            readonly kind?: 'compaction';
            readonly text: string;
            readonly keep?: string;
            readonly summarizer?: {
              readonly provider: string;
              readonly model: string;
              readonly reasoning?: string | null;
            };
            readonly attachments?: readonly {
              readonly id: string;
              readonly mime: string;
              readonly url: string;
              readonly filename?: string;
            }[];
            readonly from?: string;
            readonly senderThreadId?: string;
            readonly senderProjectId?: number;
            readonly intent?: string;
            readonly notice?: {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'ran' | 'compacted' | 'cooled';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'model-changed';
              readonly from: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly to: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'tasks';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'deleted';
              readonly by: string;
              readonly at: string;
              readonly ended: {
                readonly run: boolean;
                readonly owed: boolean;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'call-ending';
              readonly runId: string;
              readonly toolCallId: string;
              readonly tool: string;
              readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
              readonly threads: readonly ({
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              })[];
              readonly guides?: readonly ({
                readonly text: string;
                readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
                readonly ruleId?: string;
                readonly state?: {
                  readonly [key: string]: unknown;
                };
                readonly batchKey?: string;
                readonly covers?: readonly string[];
                readonly retell?: false;
                readonly withholds?: readonly string[];
                readonly toolName?: string;
                readonly toolCallId?: string;
                readonly taskId?: string;
              })[];
            } | {
              readonly kind: 'command-ending';
              readonly execution: string;
              readonly incarnation: number;
              readonly label?: string;
              readonly command: string | null;
              readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
              readonly exit: {
                readonly kind: 'code';
                readonly code: number;
              } | {
                readonly kind: 'signal';
                readonly signal: string;
              } | null;
              readonly tail: string | null;
            } | {
              readonly kind: 'thread-event';
              readonly thread: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
              readonly wakes: boolean;
              readonly forOperator?: boolean;
            };
            readonly occurredAt: string;
          })[];
          readonly steers: readonly ({
            readonly id: string;
            readonly runId: string;
            readonly kind?: 'compaction';
            readonly text: string;
            readonly keep?: string;
            readonly summarizer?: {
              readonly provider: string;
              readonly model: string;
              readonly reasoning?: string | null;
            };
            readonly attachments?: readonly {
              readonly id: string;
              readonly mime: string;
              readonly url: string;
              readonly filename?: string;
            }[];
            readonly from?: string;
            readonly senderThreadId?: string;
            readonly senderProjectId?: number;
            readonly intent?: string;
            readonly notice?: {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'ran' | 'compacted' | 'cooled';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'model-changed';
              readonly from: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly to: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'tasks';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'deleted';
              readonly by: string;
              readonly at: string;
              readonly ended: {
                readonly run: boolean;
                readonly owed: boolean;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'call-ending';
              readonly runId: string;
              readonly toolCallId: string;
              readonly tool: string;
              readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
              readonly threads: readonly ({
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              })[];
              readonly guides?: readonly ({
                readonly text: string;
                readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
                readonly ruleId?: string;
                readonly state?: {
                  readonly [key: string]: unknown;
                };
                readonly batchKey?: string;
                readonly covers?: readonly string[];
                readonly retell?: false;
                readonly withholds?: readonly string[];
                readonly toolName?: string;
                readonly toolCallId?: string;
                readonly taskId?: string;
              })[];
            } | {
              readonly kind: 'command-ending';
              readonly execution: string;
              readonly incarnation: number;
              readonly label?: string;
              readonly command: string | null;
              readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
              readonly exit: {
                readonly kind: 'code';
                readonly code: number;
              } | {
                readonly kind: 'signal';
                readonly signal: string;
              } | null;
              readonly tail: string | null;
            } | {
              readonly kind: 'thread-event';
              readonly thread: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
              readonly wakes: boolean;
              readonly forOperator?: boolean;
            };
            readonly occurredAt: string;
          })[];
          readonly arrived?: readonly ({
            readonly type: 'signal';
            readonly id: string;
            readonly runId?: string;
            readonly signalType: string;
            readonly addressee: 'reader' | 'transport';
            readonly text: string;
            readonly title?: string;
            readonly senderThreadId?: string;
            readonly senderProjectId?: number;
            readonly notice?: {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'ran' | 'compacted' | 'cooled';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'model-changed';
              readonly from: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly to: {
                readonly provider: string;
                readonly model: string | null;
                readonly reasoning: string | null;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'tasks';
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'child-update';
              readonly child: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'deleted';
              readonly by: string;
              readonly at: string;
              readonly ended: {
                readonly run: boolean;
                readonly owed: boolean;
              };
              readonly forOperator: boolean;
              readonly cost: {
                readonly kind: 'warm';
                readonly tokens: number | null;
                readonly until: string;
              } | {
                readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
                readonly tokens: number | null;
              };
            } | {
              readonly kind: 'call-ending';
              readonly runId: string;
              readonly toolCallId: string;
              readonly tool: string;
              readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
              readonly threads: readonly ({
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              })[];
              readonly guides?: readonly ({
                readonly text: string;
                readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
                readonly ruleId?: string;
                readonly state?: {
                  readonly [key: string]: unknown;
                };
                readonly batchKey?: string;
                readonly covers?: readonly string[];
                readonly retell?: false;
                readonly withholds?: readonly string[];
                readonly toolName?: string;
                readonly toolCallId?: string;
                readonly taskId?: string;
              })[];
            } | {
              readonly kind: 'command-ending';
              readonly execution: string;
              readonly incarnation: number;
              readonly label?: string;
              readonly command: string | null;
              readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
              readonly exit: {
                readonly kind: 'code';
                readonly code: number;
              } | {
                readonly kind: 'signal';
                readonly signal: string;
              } | null;
              readonly tail: string | null;
            } | {
              readonly kind: 'thread-event';
              readonly thread: {
                readonly threadId: string;
                readonly projectId?: number;
                readonly name: string | null;
              };
              readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
              readonly wakes: boolean;
              readonly forOperator?: boolean;
            };
            readonly attachments?: readonly {
              readonly mime: string;
              readonly url: string;
              readonly filename?: string;
            }[];
            readonly unconfirmed?: true;
            readonly occurredAt?: string;
            readonly rewound?: {
              readonly by: string;
              readonly scope: 'from' | 'turn';
            };
          })[];
        };
        readonly status: {
          readonly threadId: string;
          readonly runId: string | null;
          readonly life: 'idle' | 'working' | 'awaiting' | 'stalled';
          readonly stage: 'starting' | 'running' | 'streaming' | 'compacting' | 'resuming' | 'awaiting-question' | 'completed' | 'failed' | 'aborted' | 'cut' | null;
          readonly openQuestions: readonly string[];
          readonly since: string | null;
          readonly ownership?: 'held' | 'stale-evidence' | 'recovering';
          readonly halt?: {
            readonly reason: string;
          };
          readonly ending?: {
            readonly runId: string;
            readonly status: 'completed' | 'failed' | 'aborted' | 'cut' | 'withdrawn';
            readonly stoppedBy: 'reader' | 'parent' | 'agent' | 'model' | null;
            readonly failureReason: string | null;
            readonly finishedAt: string;
            readonly notification: 'confirmed' | 'claimed' | 'retry-wait' | 'notification-exhausted';
            readonly words?: {
              readonly text: string;
              readonly attachments?: readonly {
                readonly mime: string;
                readonly url: string;
                readonly filename?: string;
              }[];
            };
          };
          readonly launchBlocked?: true;
          readonly wordsWait?: 'archived' | 'launch-refused' | 'words-unsettled' | 'composer-draft';
          readonly receipts: readonly ({
            readonly key: string;
            readonly status: 'queued' | 'steered';
            readonly runId: string;
            readonly itemId: string;
            readonly occurredAt: string;
          })[];
        };
        readonly now: string;
        readonly contextLimit: {
          readonly window: number;
          readonly compaction: {
            readonly at: number;
            readonly strategy: 'percent' | 'reserve-output';
            readonly share: number | null;
            readonly source: 'override' | 'row' | 'global';
          } | null;
        } | null;
        readonly transcript: readonly unknown[];
        readonly before: number | null;
        readonly open: readonly ({
          readonly entry: unknown;
          readonly from: number;
        } | unknown)[];
        readonly progress: {
          readonly phase: {
            readonly phase: 'opening' | 'preparing' | 'calling' | 'reasoning' | 'writing' | 'tools' | 'compacting' | 'retrying';
            readonly since: number;
            readonly waiting?: {
              readonly reason: string;
              readonly place: string | null;
            };
          } | null;
          readonly estimate: {
            readonly stepNumber: number;
            readonly tokens: number;
            readonly contextWindow: number | null;
          } | null;
        } | null;
      };
      readonly status: 'loaded';
    };
  };
  readonly snapshot_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      /** An element reference a snapshot or a picked element answered, like `e12`. */
      readonly within?: string;
      /** How many rows to answer, 844 by default and 844 at most for this reading. The answer carries the total and the cursor, so a cut is never silent. */
      readonly limit?: number;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly text: string;
      readonly shown: number;
      readonly more: boolean;
      readonly status: 'snapshot';
    };
  };
  readonly start_turn: {
    readonly input: {
      readonly threadId: string;
      readonly text?: string;
      readonly attachments?: readonly {
        readonly id: string;
      }[];
      readonly key: string;
    };
    readonly answer: {
      readonly runId: string;
      readonly acted: boolean;
      readonly status: 'started';
    } | {
      readonly runId: string;
      readonly itemId: string;
      readonly acted: boolean;
      readonly status: 'steered';
    } | {
      readonly runId: string;
      readonly queued: {
        readonly id: string;
        readonly runId: string;
        readonly kind?: 'compaction';
        readonly text: string;
        readonly keep?: string;
        readonly summarizer?: {
          readonly provider: string;
          readonly model: string;
          readonly reasoning?: string | null;
        };
        readonly attachments?: readonly {
          readonly id: string;
        }[];
        readonly from?: string;
        readonly senderThreadId?: string;
        readonly senderProjectId?: number;
        readonly intent?: string;
        readonly notice?: {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'ran' | 'compacted' | 'cooled';
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'model-changed';
          readonly from: {
            readonly provider: string;
            readonly model: string | null;
            readonly reasoning: string | null;
          };
          readonly to: {
            readonly provider: string;
            readonly model: string | null;
            readonly reasoning: string | null;
          };
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'tasks';
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'child-update';
          readonly child: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'deleted';
          readonly by: string;
          readonly at: string;
          readonly ended: {
            readonly run: boolean;
            readonly owed: boolean;
          };
          readonly forOperator: boolean;
          readonly cost: {
            readonly kind: 'warm';
            readonly tokens: number | null;
            readonly until: string;
          } | {
            readonly kind: 'cold' | 'likely-warm' | 'estimated-cold' | 'unknown';
            readonly tokens: number | null;
          };
        } | {
          readonly kind: 'call-ending';
          readonly runId: string;
          readonly toolCallId: string;
          readonly tool: string;
          readonly outcome: 'completed' | 'failed' | 'stopped' | 'interrupted';
          readonly threads: readonly ({
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          })[];
          readonly guides?: readonly ({
            readonly text: string;
            readonly hook: 'beforeStep' | 'beforeTool' | 'afterTool' | 'beforeClose';
            readonly ruleId?: string;
            readonly state?: {
              readonly [key: string]: unknown;
            };
            readonly batchKey?: string;
            readonly covers?: readonly string[];
            readonly retell?: false;
            readonly withholds?: readonly string[];
            readonly toolName?: string;
            readonly toolCallId?: string;
            readonly taskId?: string;
          })[];
        } | {
          readonly kind: 'command-ending';
          readonly execution: string;
          readonly incarnation: number;
          readonly label?: string;
          readonly command: string | null;
          readonly ending: 'completed' | 'stopped' | 'expired' | 'unknown';
          readonly exit: {
            readonly kind: 'code';
            readonly code: number;
          } | {
            readonly kind: 'signal';
            readonly signal: string;
          } | null;
          readonly tail: string | null;
        } | {
          readonly kind: 'thread-event';
          readonly thread: {
            readonly threadId: string;
            readonly projectId?: number;
            readonly name: string | null;
          };
          readonly event: 'rested' | 'failed' | 'stalled' | 'awaiting' | 'addresses-human' | 'stopped' | 'committed' | 'task-closed';
          readonly wakes: boolean;
          readonly forOperator?: boolean;
        };
        readonly occurredAt: string;
      };
      readonly acted: boolean;
      readonly status: 'queued';
    };
  };
  readonly stop_run: {
    readonly input: {
      readonly threadId: string;
      readonly runId?: string;
      readonly withdraw?: boolean;
    };
    readonly answer: {
      readonly runId: string;
      readonly status: 'stopped';
    } | {
      readonly runId: string;
      readonly status: 'requested';
    } | {
      readonly status: 'nothing-running';
    } | {
      readonly runId: string;
      readonly status: 'run-mismatch';
    };
  };
  readonly trace_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly action: 'load' | 'start' | 'stop';
      readonly cold?: boolean;
      readonly screenshots?: boolean;
      /** For load: how long to wait for the page to settle, at most 120000 ms. */
      readonly timeoutMs?: number;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      /** The trace id trace_page answered. */
      readonly trace: string;
      /** Where the trace is written once it stops. */
      readonly path: string;
      readonly status: 'started';
    } | {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly trace: string;
      readonly path: string;
      readonly bytes: number;
      readonly durationMs: number;
      readonly conditions: string | null;
      /** Chromium reported dropping events: the trace buffer filled. */
      readonly dataLoss: boolean;
      /** For a load: whether the page reached its load event and a quiet with no request in flight before the deadline. */
      readonly settled: boolean | null;
      readonly sets: readonly ({
        /** NAVIGATION_<n> for a navigation, NO_NAVIGATION for the range before any. */
        readonly id: string;
        readonly url: string;
        /** Where the set starts, in milliseconds from the start of the trace. */
        readonly startMs: number;
        readonly durationMs: number;
        readonly lcp: {
          readonly ms: number;
          readonly element: string | null;
          readonly url: string | null;
          readonly phases: {
            readonly ttfb: number;
            readonly loadDelay: number | null;
            readonly loadDuration: number | null;
            readonly renderDelay: number;
          } | null;
        } | null;
        readonly inpMs: number | null;
        readonly cls: number | null;
        readonly failed: readonly ({
          readonly insight: 'LCPBreakdown' | 'INPBreakdown' | 'CLSCulprits' | 'DocumentLatency' | 'RenderBlocking' | 'LCPDiscovery' | 'NetworkDependencyTree' | 'ImageDelivery' | 'FontDisplay' | 'Viewport' | 'DOMSize' | 'ThirdParties' | 'DuplicatedJavaScript' | 'SlowCSSSelector' | 'ForcedReflow' | 'Cache' | 'CharacterSet' | 'ModernHTTP' | 'LegacyJavaScript';
          readonly line: string;
        })[];
      })[];
      /** How many insight sets the trace holds; the first twenty are kept and listed. */
      readonly setsTotal: number;
      readonly status: 'traced';
    };
  };
  readonly unpin_view: {
    readonly input: {
      readonly threadId: string;
      readonly plugin: string;
      readonly view: string;
      readonly key: string;
    };
    readonly answer: {
      readonly threadId: string;
      readonly plugin: string;
      readonly view: string;
      readonly key: string;
      readonly status: 'unpinned';
    };
  };
  readonly update_profile: {
    readonly input: {
      /** The profile id list_profiles answered. */
      readonly profile: string;
      /** The profile's name, at most 80 characters. */
      readonly name?: string;
      readonly console?: 'auto' | 'always' | 'never';
      readonly input?: 'human' | 'fast';
    };
    readonly answer: {
      readonly profile: {
        readonly id: string;
        readonly name: string;
        readonly adapter: string;
        /** `auto` captures console on loopback and private-network pages and on any page after its console is first read; `always` on every driven page; `never` refuses console reads. */
        readonly console: 'auto' | 'always' | 'never';
        readonly input: 'human' | 'fast';
        readonly connected: boolean;
        readonly removal: 'delete' | 'clear' | null;
        readonly createdAt: string;
      };
      readonly status: 'updated';
    };
  };
  readonly wait_for_page: {
    readonly input: {
      /** Registered project name or id; global selects the shared graph, tagma the server’s source project. Omitted: the project of the block, path, checkout or thread this call names, otherwise the call’s project (a thread’s home by default). A conflicting subject refuses place-mismatch; an alias shared with a project name refuses ambiguous-project. */
      readonly project?: string | number;
      /** The page id open_page or list_pages answered; omitted, the page this thread worked with last. */
      readonly page?: string;
      readonly until: 'load' | 'text' | 'url' | 'element';
      readonly value?: string;
      /** How long to wait, at most 120000 ms. */
      readonly timeoutMs: number;
    };
    readonly answer: {
      readonly page: {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly loading: boolean;
        readonly dialog: {
          readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
          readonly message: string;
          readonly prompt: string | null;
          readonly url: string;
        } | null;
        readonly navigated: boolean;
        readonly conditions: string | null;
      };
      readonly waitedMs: number;
      readonly status: 'met';
    };
  };
};
