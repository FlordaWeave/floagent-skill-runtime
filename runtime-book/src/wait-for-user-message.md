# Wait For User Messages

Use `flo.task.waitForUserMessage(...)` when a script tool needs to stop and wait for a later user reply before continuing.

This is useful for flows such as:

- asking the user to confirm an external action
- waiting for the user to finish a browser login
- collecting missing information before continuing a long-running task

## API Name

The public runtime API is `flo.task.waitForUserMessage(...)`.

Some internal and legacy suspension payloads may still mention `wait_for_human` or `script_wait_for_human`, but authored tools should use `waitForUserMessage`.

## Basic Usage

```ts
import * as flo from "flo:runtime";

const response = await flo.task.waitForUserMessage({
  user_message: "Please finish the login, then reply done.",
});

return {
  user_message: response.user_message,
};
```

When called for the first time, the helper suspends the current task. The task resumes when a later user message is dispatched back to the suspended task.

## Resume Behavior

The runtime re-enters the script from its entrypoint after resume. It does not preserve the JavaScript stack.

Use `resume_payload` to carry a small checkpoint through the suspension:

```ts
import * as flo from "flo:runtime";

const response = await flo.task.waitForUserMessage({
  user_message: "Approve the pending order, then reply approved.",
  resume_payload: {
    order_id: input.order_id,
    step: "approval",
  },
});

return {
  approved_by_reply: response.user_message,
  checkpoint: response.resume_payload,
};
```

The returned `response.user_message` is the message that resumed the task. The returned `response.resume_payload` is the checkpoint payload that was stored when the task suspended.

For larger or shared checkpoints, persist state before suspending:

- use `flo.task.putToolState(...)` for tool-owned checkpoints
- use `flo.task.putState(...)` when later tools in the same task need the checkpoint

## Resume Schema

You can provide `resume_schema` to validate the checkpoint payload before suspension and again after resume:

```ts
const response = await flo.task.waitForUserMessage({
  user_message: "Reply with done after the export is ready.",
  resume_schema: {
    type: "object",
    properties: {
      export_id: { type: "string" },
    },
    required: ["export_id"],
  },
  resume_payload: {
    export_id: input.export_id,
  },
});
```

`resume_schema` validates the checkpoint payload, not the user's message text.

## Browser Handoff

When browser automation reaches a human-required state, call `waitForUserMessage(...)` after saving any progress you need. The runtime may include browser resume data in the internal suspension payload so the task can continue with restored browser state after the user replies.

## Local Testing

The local Node preload shim declares `flo.task.waitForUserMessage(...)`, but it intentionally fails at runtime because user-message suspension requires a real task dispatcher.

Next: [Debug Events](debug-events.md)
