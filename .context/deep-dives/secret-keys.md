---
title: "Secret Keys"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/secret-keys.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Secret Keys.md" # historical provenance; migrated 2026-08-12
updated: "2026-03-22"
---

# Secret Configuration Boundary

This public context corpus documents **where** secret-backed configuration is managed and how
to troubleshoot a self-hosted deployment. It intentionally does **not** publish a secret-name
inventory, values, deployment identifiers, internal addresses, rotation steps, or commands that
could reveal a configured value. Never commit a secret value or copy it into agent context.

---

## Authorities

| Deployment surface                                  | Authoritative configuration store                                    | Use in troubleshooting                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Managed cloud runtime                               | Fly.io secrets                                                       | Confirm that the deployment has the credentials needed for its enabled services.                                         |
| Local development and managed-secret administration | Infisical                                                            | Consult the project/environment selected by the operator; do not infer an environment or inventory from this repository. |
| Home poller                                         | Portainer stack environment, wired through `docker-compose.home.yml` | Confirm that the stack supplies the values named by its compose allow-list, then redeploy to apply a change.             |

For a self-hosted installation, create equivalent credentials in the store used by that
installation. The authoritative required-variable names and consumers are the enabled service
configuration and source code in `devops/pollers/`, not this document.

---

## Safe troubleshooting sequence

1. Identify the affected service and its deployment surface.
2. Inspect the service's source/configuration to determine which configuration category it uses
   (database access, publishing, external feed, optional integration, or network identity).
3. Check the operator's applicable secret store for the presence and access policy of the
   required configuration. Do not print or paste values into terminals, logs, issues, or chat.
4. For the home poller, confirm the compose allow-list includes the required variable and
   recreate the stack after changing its environment; a restart alone does not apply new values.
5. Verify recovery with service logs and public health endpoints, not by displaying environment
   values.

## Related

- `.context/infrastructure.md` — deployment topology and configuration propagation
- `.context/deep-dives/remote-poller.md` — cloud poller responsibilities and safe diagnostics
- `.context/deep-dives/home-poller.md` — home-poller deployment and troubleshooting
