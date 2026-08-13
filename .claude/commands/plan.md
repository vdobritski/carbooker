---
description: Plan a feature or task with the architect agent (no code written)
argument-hint: [what to plan, or a task file path]
---

Plan the following work for Carbooker: **$ARGUMENTS**

You are the coordinator. Do not design this yourself and do not write any code.

1. Gather the context the architect needs: the relevant part of `docs/requirements.md`,
   the existing task files in `docs/tasks/`, and anything the user just told you.
2. Launch the `architect` subagent with that context. Tell it explicitly what to plan and
   remind it that it writes only under `docs/`.
3. When it returns, report back to the user:
   - the proposed approach in a few sentences
   - the files that will change
   - the database changes (tables, columns, constraints, policies)
   - the task list in order, with dependencies
   - anything the architect had to assume, and any open question
4. Stop there and ask for approval. Do not start implementing.

Keep it proportionate — this is a small internal MVP. If the request is a one-line change
that needs no plan, say so instead of spawning an agent.
