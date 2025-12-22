# csvt-database

Centralized, API-driven data pipelines for CarShare Vermont.

This repository consolidates data from external systems (e.g. Stripe, Zemtu, fleet systems)
into a shared operational database to support planning, evaluation, reporting, and
Transportation Demand Management (TDM) efforts.

## Purpose
- Support data-informed planning and policy work
- Improve visibility into service usage, access, and impact
- Enable consistent reporting for municipalities, developers, and partners

## Structure
- `pipelines/` — vendor-specific data pipelines (Stripe, Zemtu, etc.)
- `lib/` — shared utilities (database, logging, helpers)
- `.github/workflows/` — scheduled GitHub Actions
- `scripts/` — legacy runners and debugging utilities

## Notes
- Secrets are not committed to this repository
- Local configuration uses `.env`
- Production secrets are managed via GitHub Actions

This project is under active development.
