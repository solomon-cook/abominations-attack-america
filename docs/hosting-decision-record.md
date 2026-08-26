# Hosting decision record

## Decision

Hosting remains undecided. The repository records provider-neutral requirements and release evidence gates, but does not select a hosting provider or claim that staging, production, managed Postgres, backups, alerts, or a public endpoint exist.

## Options and decision criteria

The eventual provider must support the requirements in [`docs/deployment-requirements.md`](deployment-requirements.md): static web delivery, durable API compute, WebSockets and polling fallback, managed Postgres with Prisma migrations and backup/restore, environment-scoped secrets, and observable health and failure signals. The decision must be based on those capabilities and on a reversible operational path, not on provider branding.

The following must be recorded before selection:

- separate staging and production URLs, databases, credentials, allowed origins, logs, and alert destinations;
- HTTPS/WSS and proxy upgrade behaviour, request/time-out limits, rate-limit controls, and secret rotation;
- migration ownership, backup retention, restore access, rollback strategy, and incident escalation;
- cost, access ownership, regional/data handling constraints, and an exit path.

## Release evidence gate

The canonical provider-neutral record shape is [`docs/release-evidence-schema.json`](release-evidence-schema.json). Its embedded `x-empty-template` is deliberately `not_recorded` for every required category; it is a valid template and is not a release result. The schema requires evidence slots for environment, commit, migration, soak, smoke, backup/restore, security, rollback, and approvals.

Until those slots contain source-linked, reviewable evidence, deployment status remains open. Local tests, builds, and documentation do not fill hosted environment, managed-database, backup/restore, or approval evidence.

## Next decision owner and trigger

The project owner should select a provider only after the requirements and release gates can be met with scoped credentials and a disposable staging path. Record the provider, account/project ownership, environment identifiers, and an initial evidence record in a follow-up change; this document intentionally does not invent those values.
