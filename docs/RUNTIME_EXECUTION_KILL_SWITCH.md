# Runtime Execution Kill Switch

GrowthOS uses a process-level deployment kill switch in addition to action-level policy and autonomy controls.

## Default state

If `GROWTHOS_EXECUTION_MODE` is unset or blank, the process is `READ_ONLY`.

This is deliberate. A healthy database, clean restart state, valid action envelope, or caller request does not imply that the deployment is permitted to expose mutation-capable runtime state.

## Allowed values

`GROWTHOS_EXECUTION_MODE` accepts only:

- `read_only`
- `enabled`

Common truthy values such as `true`, `1`, `yes`, or `on` are rejected rather than coerced.

## Bootstrap composition

`bootstrapTenantRuntime()` enables its mutation-capable `executionStore` only when all three conditions hold:

1. `executionRequested === true`;
2. `GROWTHOS_EXECUTION_MODE=enabled`;
3. startup readiness is clean.

Otherwise the runtime is `READ_ONLY` and exposes only the read surface.

## Authority layering

The process kill switch is an infrastructure safety control. It does not replace:

- tenant/action-family autonomy envelopes;
- exact policy authorization;
- upstream capability certification;
- spend/recipient/attempt ceilings;
- execution reconciliation;
- Wiserr messaging/compliance authority.

Even when the process execution mode is enabled, individual actions still require every lower-level authority gate.

## Operational doctrine

Emergency shutdown can be achieved by setting the deployment to `read_only` and restarting/redeploying the worker. A caller cannot override that state by requesting execution.

No component should interpret database reachability or successful startup checks as permission to change `GROWTHOS_EXECUTION_MODE` automatically.
