# Naming and Org Scope

This app uses product names in routes and canonical/entity names in the database.

## Product Routes

- `/contacts`: sales contacts.
- `/companies`: target companies/accounts.
- `/icps`: ideal customer profiles.
- `/my-company`: the workspace/company profile for the seller.
- `/my-profile`: the signed-in member's profile.

Legacy compatibility routes may exist, but new code should not point at them:

- `/leads/contacts` -> `/contacts`
- `/leads/accounts` -> `/companies`
- `/accounts` -> `/companies`

## API Routes

- `/api/contacts`: sales contact list/detail/edit.
- `/api/companies`: company/account list/detail/edit.
- `/api/buyer-personas`: buyer persona CRUD.

Legacy compatibility wrappers may exist, but new code should not call them:

- `/api/leads` -> `/api/contacts`
- `/api/accounts` -> `/api/companies`

## Database Names

- `people`: canonical global humans enriched by Arcova/provider data.
- `companies`: canonical global companies enriched by Arcova/provider data.
- `org_contact_state`: org-scoped contact membership/state such as triage, archive, pin, and suppress.
- `org_contact_overrides`: org-scoped manual person-field overrides.
- `org_companies`: org-scoped company/account membership and scoring state.
- `org_company_overrides`: org-scoped manual company-field overrides.
- `icps`: ICP definitions; org/shared vs personal is represented by scope columns, not route names.

Manual customer edits must not write to `people` or `companies`. Read resolution is:

```text
org override -> canonical value
```

Use `user_*` tables only for genuinely personal data or compatibility during migration.
