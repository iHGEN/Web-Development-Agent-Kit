# Web Quality Contract

Every implementation should favor:

1. Correctness before cleverness.
2. Clear ownership of responsibilities.
3. Readable code over compressed code.
4. Small, cohesive units with meaningful names.
5. Existing conventions before inventing new conventions.
6. Reuse of existing behavior before duplication.
7. Explicit boundaries between UI, application logic, domain logic, persistence, and integrations.
8. Testability without excessive interfaces or mock-only architecture.
9. Safe input validation and output encoding.
10. Authorization at the correct server-side boundary.
11. Async/non-blocking I/O where appropriate.
12. Consistent error handling and observability.
13. Performance appropriate to measured workload.
14. Backward-compatible contracts unless change is explicitly requested.
15. Minimal hidden state and surprising side effects.

## Flexibility

"Flexible" means an important implementation can be changed or extended without rewriting unrelated
systems. It does not mean every class needs an interface or every function needs a strategy pattern.

Add abstractions only when justified by:
- a real runtime variation;
- multiple real implementations;
- an architectural boundary;
- a test seam that cannot be achieved more simply;
- repeated domain behavior;
- a stable public contract.

## Prohibited habits

Avoid:
- duplicate services with overlapping ownership;
- "Manager"/"Helper"/"Utils" dumping grounds;
- speculative abstraction;
- unrelated refactors inside feature work;
- magic strings/numbers for meaningful domain values;
- giant methods/classes when responsibilities are separable;
- deep nesting where guard clauses improve clarity;
- swallowed exceptions;
- client-side authorization as the only authorization;
- security through obscurity;
- comments that merely restate code.
