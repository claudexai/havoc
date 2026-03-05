// Universal model — protocol-agnostic types all agents work against

export interface Field {
  name: string;
  type: "string" | "int" | "float" | "bool" | "enum" | "object" | "array";
  constraints: {
    min?: number;
    max?: number;
    pattern?: string;
    enum_values?: string[];
    nullable?: boolean;
    min_items?: number;
    max_items?: number;
    items?: Field;
    fields?: Field[];
    format?: string; // uuid, email, date-time, etc.
    max_length?: number;
  };
}

export interface ErrorSchema {
  status: number;
  description?: string;
}

export interface HavocEndpoint {
  id: string;
  name: string;
  method: string;
  path: string;
  protocol: "rest" | "graphql" | "grpc" | "websocket";
  input: {
    fields: Field[];
    required: string[];
  };
  output: {
    fields: Field[];
    errors: ErrorSchema[];
  };
  dependencies: string[]; // endpoints that must run first
  creates_resource: boolean;
  resource_id_field: string;
}

export interface HavocResponse {
  status: number;
  body: any;
  errors: any[];
  timing: number; // ms
  headers: Record<string, string>;
}

export interface Bug {
  id: string;
  fingerprint: string;
  endpoint: HavocEndpoint;
  agent: string;
  generation: number;
  oracle_layer: number;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: any;
  };
  response: HavocResponse;
  curl: string;
  minimal_input?: any;
}

export interface AgentResult {
  agent: string;
  bugs: Bug[];
  requests_sent: number;
  duration: number;
}

export interface HavocConfig {
  url: string;
  spec?: string;
  graphql?: string;
  headers: Record<string, string>;
  agents: {
    boundary_walker: boolean;
    mutant_breeder: boolean;
    sequence_hunter: boolean;
    type_shapeshifter: boolean;
    slow_poison: boolean;
    chaos_timer: boolean;
    champion_evolver: boolean;
  };
  timeout: number;
  seed: number;
  failOn?: string;
  format: string;
  output?: string;
}
