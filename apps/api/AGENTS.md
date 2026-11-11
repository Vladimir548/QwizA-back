# Backend Agent Instructions

## Core Principles

- Prefer clear, maintainable, reusable, and extensible code over one-off implementations.
- Follow the existing backend architecture, naming conventions, patterns, and project structure.
- Keep responsibilities separated between layers.
- Avoid duplication in business logic, validation, data access, types, and infrastructure code.
- Before creating something new, check whether an existing service, repository, DTO, schema, utility, middleware, type, or abstraction can be reused or extended.
- Avoid overengineering. Add abstractions only when they reduce real duplication, improve boundaries, or make the code easier to maintain.

## Architecture

- Respect the existing architectural boundaries of the project.
- Keep controllers, routes, handlers, services, repositories, domain logic, and infrastructure concerns separated where the project architecture expects it.
- Controllers and route handlers should stay thin.
- Do not place complex business logic directly inside controllers or transport-layer handlers.
- Business rules should live in the appropriate service, use-case, or domain layer.
- Database access should go through the project's established data-access layer.
- Do not bypass repositories, ORM abstractions, or existing persistence patterns without a clear reason.
- Keep framework-specific code away from core business logic where practical.
- Avoid circular dependencies between modules.

## Reusability

- Do not duplicate logic that can reasonably be shared.
- If the same behavior appears in multiple places, consider extracting it into a reusable service, utility, validator, policy, middleware, mapper, or domain abstraction.
- Prefer extending existing abstractions over creating parallel implementations.
- Do not copy-paste existing business logic and modify it slightly unless there is a strong reason.
- Reuse existing validation, authorization, serialization, mapping, and error-handling patterns.
- Shared code should have a clear responsibility and stable API.

## Services and Business Logic

- Keep business logic centralized and reusable.
- Services should represent meaningful application or domain operations.
- Avoid god services that handle unrelated responsibilities.
- Split services by responsibility when they become difficult to understand or test.
- Prefer small, explicit methods with clear inputs and outputs.
- Keep side effects visible and intentional.
- Do not mix data access, transport concerns, and unrelated business rules in the same method.
- Extract repeated workflows into reusable services or use-cases where appropriate.

## Data Access

- Follow the project's existing repository, ORM, query-builder, or data-access patterns.
- Do not duplicate queries across multiple services when they represent the same operation.
- Reuse repositories or query helpers where possible.
- Keep persistence-specific details out of business logic when the architecture allows it.
- Avoid N+1 queries and unnecessary database round trips.
- Fetch only the data required for the operation when practical.
- Keep transactions explicit for operations that must succeed or fail atomically.
- Do not introduce hidden database writes inside methods that appear read-only.

## API Design

- Keep API behavior consistent with the rest of the project.
- Reuse existing response shapes, pagination conventions, error formats, and status-code patterns.
- Avoid creating multiple endpoints that represent the same operation with slightly different behavior.
- Keep transport-layer DTOs separate from persistence models when appropriate.
- Validate all external input.
- Never trust client-provided IDs, roles, permissions, ownership, or other security-sensitive values without server-side verification.
- Keep breaking API changes intentional and explicit.

## Validation

- Reuse existing validation schemas, DTOs, validators, and constraints.
- Do not duplicate the same validation rules in multiple places unless required by separate boundaries.
- Keep validation close to the boundary where invalid data enters the system.
- Business-rule validation should remain in the business/domain layer rather than only in request schemas.
- Return consistent validation errors using the project's existing error format.

## Types and Models

- Do not create multiple equivalent or nearly identical types.
- Search for an existing type, DTO, schema, interface, model, or domain object before defining a new one.
- Reuse shared domain types where appropriate.
- Compose existing types instead of manually repeating the same fields.
- Keep transport types, domain types, and persistence models separate when they represent different concepts.
- Avoid `any` where the language and project tooling allow stronger typing.
- Do not expose persistence models directly through public APIs unless that is an intentional project convention.
- Keep shared types centralized only when they are genuinely shared.

## Error Handling

- Use the project's existing error classes and error-handling mechanisms.
- Do not silently swallow errors.
- Do not catch exceptions only to rethrow them unchanged.
- Translate infrastructure-specific errors into application-level errors when appropriate.
- Do not expose stack traces, internal implementation details, SQL errors, secrets, or sensitive system information to clients.
- Keep error responses predictable and consistent.
- Log errors at the appropriate boundary rather than logging the same exception repeatedly across layers.

## Authentication and Authorization

- Reuse the project's existing authentication and authorization mechanisms.
- Authorization must be enforced server-side.
- Do not rely on frontend visibility or client-side checks for security.
- Verify resource ownership and permissions before sensitive reads or writes.
- Avoid duplicating permission logic across endpoints; centralize reusable authorization rules where practical.
- Never weaken authorization checks just to make a feature work.

## Security

- Never hardcode API keys, passwords, tokens, credentials, or secrets.
- Do not expose secrets through logs, errors, responses, tests, or source code.
- Sanitize and validate all untrusted input.
- Use parameterized queries or the project's safe ORM/query APIs.
- Avoid introducing SQL injection, command injection, path traversal, SSRF, insecure deserialization, or similar vulnerabilities.
- Treat file uploads, URLs, headers, webhooks, and external payloads as untrusted input.
- Use secure password hashing and existing authentication libraries rather than implementing cryptography manually.
- Do not disable security checks without explicit justification.

## Configuration

- Follow the project's existing configuration system.
- Do not scatter environment-variable access throughout the codebase if a central config layer exists.
- Validate required configuration at application startup where practical.
- Keep environment-specific behavior explicit.
- Do not modify secrets or production configuration unless explicitly requested.

## External Services

- Wrap third-party integrations behind clear service boundaries.
- Avoid spreading vendor-specific code throughout business logic.
- Reuse existing clients and integration services.
- Handle timeouts, retries, rate limits, and partial failures according to project conventions.
- Do not retry non-idempotent operations blindly.
- Keep external API response models separate from internal domain models when appropriate.

## Background Jobs and Async Work

- Keep background jobs idempotent where possible.
- Avoid duplicated processing when retries occur.
- Make retry behavior explicit.
- Do not hide critical failures in asynchronous workflows.
- Reuse existing queue, scheduler, and worker abstractions.
- Keep job orchestration separate from the core business logic when practical.

## Caching

- Use the project's existing caching layer and conventions.
- Do not add caching without understanding invalidation requirements.
- Keep cache keys consistent and centralized where appropriate.
- Never treat cached authorization or security-sensitive state as permanently valid without considering invalidation.
- Prefer correctness over premature caching.

## Utilities and Helpers

- Extract pure reusable transformations and calculations into utilities.
- Utilities should have one clear responsibility.
- Avoid generic helper files that become dumping grounds.
- Group utilities by domain or technical responsibility.
- Do not create multiple helpers that perform effectively the same operation.
- Prefer extending an existing utility when the responsibility matches.

## Logging and Observability

- Follow the project's existing logging conventions.
- Use structured logging when supported.
- Include useful context such as operation IDs, request IDs, or entity IDs when appropriate.
- Never log secrets, passwords, access tokens, private keys, or sensitive personal data unnecessarily.
- Avoid noisy logs inside frequently executed loops or hot paths.
- Keep metrics and tracing consistent with existing infrastructure.

## Testing

- Add or update tests for meaningful behavior changes.
- Prefer testing public behavior over implementation details.
- Reuse existing fixtures, factories, helpers, and test utilities.
- Do not duplicate large setup blocks when reusable test builders already exist.
- Cover important business rules, edge cases, permission checks, and failure paths.
- Do not remove or weaken tests only to make the suite pass.
- Keep tests deterministic.
- Avoid tests that depend unnecessarily on execution order, real external services, or unstable timing.

## Refactoring

When touching existing code:

- Improve obvious duplication if it is directly related to the requested change.
- Do not refactor unrelated parts of the system without a clear reason.
- Prefer incremental refactoring over large rewrites.
- Preserve existing behavior unless the task explicitly requires changing it.
- Consolidate repeated business rules when a shared abstraction makes the code clearer.
- Do not introduce abstractions that make simple code harder to understand.
- Keep backward compatibility where the project requires it.

## Performance

- Avoid premature optimization, but do not introduce obviously inefficient implementations.
- Watch for repeated database calls, unnecessary serialization, large in-memory transformations, and blocking work.
- Use batching, pagination, streaming, caching, or async processing when they are appropriate and already supported by the architecture.
- Measure or justify significant performance-related changes where practical.

## Before Creating New Code

Before creating a new service, repository, model, DTO, validator, utility, middleware, or abstraction, check:

1. Does something equivalent already exist?
2. Can an existing abstraction be extended safely?
3. Is this responsibility already handled by another layer?
4. Will this reduce real duplication?
5. Is there a simpler solution?
6. Does it follow the current project architecture?
7. Does it introduce unnecessary coupling?
8. Is its public API clear and minimal?

## Before Finishing a Task

Verify that:

- Business logic is placed in the correct layer.
- Controllers or handlers remain focused on transport concerns.
- Repeated logic was reused or consolidated where appropriate.
- No duplicate or nearly identical types, DTOs, validators, or services were introduced.
- Existing repositories, services, utilities, and abstractions were reused where possible.
- Input validation and authorization are enforced server-side.
- Error handling follows project conventions.
- Sensitive information is not exposed or logged.
- Database operations are correct and efficient enough for the use case.
- Transactions are used where atomicity is required.
- The implementation is flexible without being overengineered.
- Relevant tests pass.
- Type checking, linting, formatting, and project-specific checks pass where available.

## Final Response

At the end of a task, briefly report:

- what was changed;
- which architectural layers were affected;
- which existing abstractions were reused;
- whether any duplication was removed;
- what was tested or verified;
- any remaining risks, tradeoffs, migrations, or operational concerns.
