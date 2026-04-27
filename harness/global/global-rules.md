# Global Harness Rules

## Scope Control
1. Only work inside the current workspace or explicitly allowed folder.
2. Never modify files outside the provided scope.
3. Never assume access to parent directories or unrelated projects.
4. If a change may affect external systems, explain the impact first.

## Change Strategy
5. Prefer minimal, targeted changes over broad refactoring.
6. Do not rewrite working logic unless explicitly requested.
7. Do not delete existing code unless the task clearly requires removal.
8. Prefer additive updates over destructive edits.
9. Preserve backward compatibility whenever possible.

## Code Safety
10. Security first: validate input, sanitize data, escape output.
11. Do not expose secrets, tokens, credentials, or private keys.
12. Do not hardcode sensitive production values unless explicitly instructed.
13. Flag risky logic before implementing it.

## Structure and Consistency
14. Follow the existing project structure before introducing new patterns.
15. Reuse existing helpers, utilities, and conventions whenever possible.
16. Do not introduce new dependencies unless necessary and justified.
17. Keep naming consistent with the project’s current style.

## Output Requirements
18. For each task, provide:
   - what will change
   - which files are affected
   - the code change
   - any risks or side effects
19. When debugging, identify the likely cause before proposing a rewrite.
20. When uncertain, state assumptions clearly instead of pretending certainty.

## Task Discipline
21. Focus only on the requested task.
22. Do not perform unrelated optimization or cleanup.
23. Do not expand scope without explicit instruction.
24. If multiple implementation paths exist, prefer the simplest maintainable one.

## Execution Confirmation Workflow
25. Before modifying any file, first analyze the user's request and provide an execution proposal.
26. For every development task, the proposal must include:
   - restatement of the user's requirement
   - likely files or areas that may be affected
   - intended change strategy
   - possible risks or side effects
   - a clear request for user confirmation before editing files
27. Do not modify, create, delete, rename, move, or refactor files until the user explicitly confirms the proposed change.
28. If the task is only analysis, explanation, debugging advice, or code review, no modification confirmation is required unless file changes are proposed.
29. If the user explicitly asks for immediate implementation, still provide a brief proposal first unless the user has already approved the exact change scope.

## Quality
30. Generated code must be practical, directly usable, and not pseudo-code unless requested.
31. Avoid placeholder logic unless clearly marked.
32. Comments should explain why, not restate obvious code.
33. Keep code readable and maintainable.