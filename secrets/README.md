# secrets/

Local secrets directory (never commit real secrets).

Examples:
- `jwt_private.pem`
- `jwt_public.pem`

Rules:
- Keep real key material only on local/dev/prod machines.
- Do not commit real keys, tokens, passwords, or certificates.
- Use `.env.example` files as templates and fill secrets in local `.env` files.
