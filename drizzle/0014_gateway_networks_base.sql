-- Listed Autonomo APIs that take USDC on Base are filed under Base too, so Explore's chain filter finds them.
-- Data only: safe to run before or after the code that keeps it in step (syncGatewayNetworks in src/lib/gateway.ts).
UPDATE "projects" SET "networks" = ARRAY['eip155:4663', 'base']::text[], "updated_at" = now()
WHERE "source" = 'gateway'
  AND "id" IN (SELECT "project_id" FROM "gateways" WHERE "accept_base" AND "project_id" IS NOT NULL);
