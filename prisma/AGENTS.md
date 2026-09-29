# Prisma Guidance

- Treat every new model, delegate, relation, enum, or field reference as Prisma impact, even when `schema.prisma` is unchanged.
- Never use `prisma migrate reset`, `prisma db push`, destructive seeds, or bulk deletes against a shared or production database without explicit approval.
- Generate and validate the client only when the task actually changes Prisma contracts. Follow the Prisma release checks in the root `AGENTS.md`.
