/** The dedicated OpenAPI 3.1 document consumed by OpenWebUI later. */

const commonResponses = {
  200: { description: "Bounded read-only control-plane result" },
  400: { description: "Invalid or unsupported filter" },
  401: { description: "Missing or invalid read-only bearer" },
  503: { description: "No schema-valid read model is available" },
};

const stringQuery = (name, description, maxLength = 64) => ({
  name,
  in: "query",
  required: false,
  description,
  schema: { type: "string", maxLength },
});

const limitQuery = {
  name: "limit",
  in: "query",
  required: false,
  description: "Maximum result count",
  schema: { type: "integer", minimum: 1, maximum: 20, default: 20 },
};

export const CONTROL_PLANE_OPERATIONS = Object.freeze([
  "GetEstateSummary",
  "GetServiceStatus",
  "GetReleaseStatus",
  "ListActiveFindings",
  "GetQuotaProjection",
  "GetBackupStatus",
  "ListGardenerProposals",
  "FindRunbook",
  "SearchEvidence",
]);

export function buildControlPlaneToolOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Atlas control-plane tools for Ramone",
      version: "1.0.0",
      description:
        "Nine bounded read-only Atlas operations. The future RAMONE_CONTROL_PLANE_READ_TOKEN is held by the administrator-owned OpenWebUI external-tool connection and is never a model parameter.",
    },
    servers: [{ url: "https://api.atlas-systems.uk" }],
    security: [{ ramoneReadBearer: [] }],
    paths: {
      "/v1/control-plane/tools/summary": {
        get: {
          operationId: "GetEstateSummary",
          summary: "Get the bounded estate control-plane summary",
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/services/{service_id}": {
        get: {
          operationId: "GetServiceStatus",
          summary: "Get one allowlisted service status",
          parameters: [
            {
              name: "service_id",
              in: "path",
              required: true,
              schema: {
                type: "string",
                pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
                minLength: 1,
                maxLength: 64,
              },
            },
          ],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/releases": {
        get: {
          operationId: "GetReleaseStatus",
          summary: "Get the latest matching release verification metadata",
          parameters: [
            {
              ...stringQuery("repository", "Lower-case repository slug", 100),
              schema: {
                type: "string",
                maxLength: 100,
                pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
              },
            },
            {
              name: "environment",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["development", "preview", "production"],
              },
            },
            {
              name: "commit",
              in: "query",
              required: false,
              schema: { type: "string", pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" },
            },
          ],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/findings": {
        get: {
          operationId: "ListActiveFindings",
          summary: "List bounded redacted active findings",
          parameters: [
            stringQuery("service_id", "Stable service ID"),
            {
              name: "severity",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["info", "warning", "failure", "critical"],
              },
            },
            limitQuery,
          ],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/quota": {
        get: {
          operationId: "GetQuotaProjection",
          summary: "Get current and projected quota metadata",
          parameters: [stringQuery("meter_id", "Allowlisted quota meter")],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/backups": {
        get: {
          operationId: "GetBackupStatus",
          summary: "Get backup freshness and safe restore-test metadata",
          parameters: [stringQuery("target_id", "Stable backup target ID")],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/gardener/proposals": {
        get: {
          operationId: "ListGardenerProposals",
          summary: "List dry-run or review-only Gardener proposal metadata",
          parameters: [
            {
              ...stringQuery("repository", "Lower-case repository slug", 100),
              schema: {
                type: "string",
                maxLength: 100,
                pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
              },
            },
            {
              name: "risk_class",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["low", "medium", "high"] },
            },
            {
              name: "state",
              in: "query",
              required: false,
              schema: {
                type: "string",
                enum: ["dry_run", "proposed", "draft_pr", "validation_failed"],
              },
            },
            limitQuery,
          ],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/runbooks/search": {
        get: {
          operationId: "FindRunbook",
          summary: "Find up to five safe runbook summaries",
          parameters: [
            {
              name: "query",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 200 },
            },
            stringQuery("service_id", "Stable service ID"),
          ],
          responses: commonResponses,
        },
      },
      "/v1/control-plane/tools/evidence/search": {
        get: {
          operationId: "SearchEvidence",
          summary: "Search bounded evidence metadata without fetching payloads",
          parameters: [
            {
              name: "query",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 200 },
            },
            stringQuery("producer", "Evidence producer"),
            stringQuery("subject", "Evidence subject", 128),
            stringQuery("since", "Inclusive UTC timestamp", 32),
            stringQuery("until", "Inclusive UTC timestamp", 32),
            limitQuery,
          ],
          responses: commonResponses,
        },
      },
    },
    components: {
      securitySchemes: {
        ramoneReadBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque-read-token",
          description:
            "Dedicated RAMONE_CONTROL_PLANE_READ_TOKEN. It grants no GitHub, Cloudflare, Home Assistant, SSH, backup, deployment, or secret permission.",
        },
      },
    },
  };
}
