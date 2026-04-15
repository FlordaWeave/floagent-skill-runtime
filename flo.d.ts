type FloGlobalFetchHeaders = Record<string, string>;

interface FloGlobalFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface FloGlobalFetchResponse {
  status: number;
  ok: boolean;
  headers: FloGlobalFetchHeaders;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

declare function fetch(input: string, init?: FloGlobalFetchInit): Promise<FloGlobalFetchResponse>;

declare module "flo:runtime" {
  type FloJsonValue =
    | null
    | boolean
    | number
    | string
    | FloJsonValue[]
    | { [key: string]: FloJsonValue };

  interface FloVaultProfileRequest {
    scope: "profile";
    key: string;
  }

  interface FloVaultSharedRequest {
    scope: "shared";
    scope_id: string;
    key: string;
  }

  type FloVaultRequest = FloVaultProfileRequest | FloVaultSharedRequest;

  interface FloStateGetRequest {
    scope: string;
    key: string;
  }

  interface FloStateListRequest {
    scope: string;
    key_prefix: string;
    limit?: number;
    cursor?: string;
  }

  interface FloStatePutRequest<T = FloJsonValue> {
    scope: string;
    key: string;
    value: T;
    ttl_seconds?: number;
    if_revision?: string | null;
  }

  interface FloStateDeleteRequest {
    scope: string;
    key: string;
    if_revision?: string | null;
  }

  interface FloStateEntry<T = FloJsonValue> {
    key: string;
    value: T;
    revision: string;
    expires_at?: string;
  }

  interface FloStateWriteResult<T = FloJsonValue> {
    ok: boolean;
    entry?: FloStateEntry<T>;
    conflict_revision?: string;
  }

  interface FloStateListResult<T = FloJsonValue> {
    entries: FloStateEntry<T>[];
    next_cursor?: string;
  }

  interface FloCallToolRequest<TInput = unknown> {
    tool_id: string;
    input: TInput;
  }

  interface FloStructuredError {
    code: string;
    message: string;
    retryable: boolean;
  }

  interface FloToolCallResult<TOutput = unknown> {
    output?: TOutput;
    error?: FloStructuredError;
    status: "success" | "failed" | "timeout" | "validation_error" | "suspended";
  }

  type FloTaskEventLevel = "info" | "warning" | "error";

  interface FloTaskEmitEventRequest {
    event_type: string;
    title?: string;
    message?: string;
    level?: FloTaskEventLevel;
    payload?: unknown;
  }

  type FloWorkerKind =
    | "extractor"
    | "matcher"
    | "classifier"
    | "summarizer"
    | "aggregator"
    | "verifier";

  interface FloSpawnChildSpec {
    worker_kind: FloWorkerKind;
    title: string;
    objective: string;
    input: FloJsonValue;
  }

  interface FloSpawnChildrenRequest {
    mode: "join_required" | "detached";
    children: FloSpawnChildSpec[];
  }

  interface FloChildBatchChild {
    child_task_id: string;
    worker_kind: FloWorkerKind;
    title: string;
    objective: string;
  }

  interface FloChildBatch {
    batch_id: string;
    parent_task_id: string;
    mode: "join_required" | "detached";
    consumed: boolean;
    children: FloChildBatchChild[];
    created_at: string;
    updated_at: string;
  }

  interface FloSpawnChildrenResponse {
    batch: FloChildBatch;
    event: unknown;
  }

  interface FloAwaitBatchRequest {
    batch_id: string;
  }

  interface FloChildResult {
    child_task_id: string;
    worker_kind: FloWorkerKind;
    status: "completed" | "failed" | "timeout" | "running" | "queued" | "suspended";
    output: FloJsonValue;
    error?: string;
    completed_at?: string;
  }

  interface FloAwaitBatchResponse {
    batch: FloChildBatch;
    results: FloChildResult[];
    all_terminal: boolean;
  }

  type FloFetchHeaders = Record<string, string>;

  interface FloFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }

  interface FloFetchResponse {
    status: number;
    ok: boolean;
    headers: FloFetchHeaders;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
  }

  interface FloBrowserRequiredCheck {
    kind: "url_not_matches" | "selector_present" | "selector_absent";
    value: string;
    timeout_ms?: number;
    reason_code?: string;
    user_message?: string;
  }

  interface FloBrowserSessionOptions {
    required_checks?: FloBrowserRequiredCheck[];
  }

  interface FloBrowserGotoCommand {
    type: "goto";
    url: string;
    wait_until?: string;
    timeout_ms?: number;
  }

  type FloBrowserRequestResourceType = "xhr" | "fetch";

  interface FloBrowserRequestCaptureMatcherBase {
    method?: string;
    resource_types?: FloBrowserRequestResourceType[];
  }

  interface FloBrowserExactRequestCaptureMatcher extends FloBrowserRequestCaptureMatcherBase {
    url: string;
    url_regex?: never;
  }

  interface FloBrowserRegexRequestCaptureMatcher extends FloBrowserRequestCaptureMatcherBase {
    url?: never;
    url_regex: string;
  }

  type FloBrowserRequestCaptureMatcher =
    | FloBrowserExactRequestCaptureMatcher
    | FloBrowserRegexRequestCaptureMatcher;

  interface FloBrowserCapturedRequest {
    url: string;
    method: string;
    resource_type: FloBrowserRequestResourceType;
    headers: Record<string, string>;
  }

  interface FloBrowserCapturedResponse {
    url: string;
    status: number;
    headers: Record<string, string>;
  }

  interface FloBrowserRequestCaptureResult {
    request: FloBrowserCapturedRequest;
    response: FloBrowserCapturedResponse;
  }

  interface FloBrowserFillCommand {
    type: "fill";
    selector: string;
    value: string;
  }

  interface FloBrowserClickCommand {
    type: "click";
    selector: string;
  }

  interface FloBrowserPressCommand {
    type: "press";
    selector: string;
    key: string;
  }

  interface FloBrowserSelectCommand {
    type: "select";
    selector: string;
    values: string[];
  }

  interface FloBrowserWaitForCommand {
    type: "wait_for";
    selector?: string;
    url?: string;
    text?: string;
    timeout_ms: number;
  }

  interface FloBrowserExtractCommand {
    type: "extract";
    selector: string;
    attribute?: string;
    text_content?: boolean;
  }

  interface FloBrowserEvaluateCommand {
    type: "evaluate";
    expression: string;
    args?: FloJsonValue;
  }

  interface FloBrowserScreenshotCommand {
    type: "screenshot";
    full_page?: boolean;
  }

  type FloBrowserCommand =
    | FloBrowserGotoCommand
    | FloBrowserFillCommand
    | FloBrowserClickCommand
    | FloBrowserPressCommand
    | FloBrowserSelectCommand
    | FloBrowserWaitForCommand
    | FloBrowserExtractCommand
    | FloBrowserEvaluateCommand
    | FloBrowserScreenshotCommand;

  interface FloBrowserCommandResult {
    current_url?: string | null;
    text?: string | null;
    attribute?: string | null;
    value?: FloJsonValue;
    screenshot_base64?: string;
  }

  interface FloBrowserStorageState {
    cookies: FloJsonValue;
    origins: FloJsonValue;
  }
  type FloBuiltinToolId =
    | "list_available_skills"
    | "read_text_file"
    | "write_text_file"
    | "read_dir"
    | "zip"
    | "unzip"
    | "csv_inspect"
    | "csv_read"
    | "csv_create"
    | "csv_edit_cells"
    | "excel_inspect"
    | "excel_read"
    | "excel_create"
    | "excel_edit_cells"
    | "excel_edit_structure"
    | "excel_auto_fit_row"
    | "excel_apply_changes"
    | "media_fetch"
    | "media_push_vfs"
    | "media_push_base64"
    | "send_notification"
    | "send_media_attachment"
    | "spawn_children"
    | "await_batch"
    | "read_skill_resource"
    | "import_skill_asset";

  type FloListAvailableSkillsInput = {};

  type FloListAvailableSkillsOutput = {
    skill_count: number;
    skills: {
        description: string;
        name: string;
        resource_count: number;
        skill_id: string;
        tools: string[];
      }[];
  };

  type FloReadTextFileInput = {
    max_bytes?: number;
    path: string;
  };

  type FloReadTextFileOutput = {
    content: string;
    max_bytes: number;
    path: string;
    size_bytes: number;
  };

  type FloWriteTextFileInput = {
    content: string;
    path: string;
  };

  type FloWriteTextFileOutput = {
    bytes_written: number;
    path: string;
  };

  type FloReadDirInput = {
    path: string;
  };

  type FloReadDirOutput = {
    entries: ({
        entry_type: "directory" | "file";
        name: string;
        path: string;
      })[];
    entry_count: number;
    path: string;
  };

  type FloZipInput = {
    input_paths: string[];
    output_path: string;
  };

  type FloZipOutput = {
    entry_count: number;
    input_paths: string[];
    output_path: string;
    size_bytes: number;
  };

  type FloUnzipInput = {
    input_path: string;
    output_dir: string;
  };

  type FloUnzipOutput = {
    entry_count: number;
    input_path: string;
    output_dir: string;
    written_paths: string[];
  };

  type FloCsvInspectInput = {
    path: string;
  };

  type FloCsvInspectOutput = {
    format: "csv";
    path: string;
    sheets: {
        columns: number;
        name: string;
        preview: string[][];
        preview_range: string;
        rows: number;
      }[];
  };

  type FloCsvReadInput = {
    path: string;
    range: string;
  };

  type FloCsvReadOutput = {
    columns: number;
    format: "csv";
    path: string;
    range: string;
    rows: number;
    sheet: string;
    values: FloJsonValue[][];
  };

  type FloCsvCreateInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
  };

  type FloCsvCreateOutput = {
    format: "csv";
    path: string;
    sheet: "Sheet1";
  };

  type FloCsvEditCellsInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
  };

  type FloCsvEditCellsOutput = {
    format: "csv";
    path: string;
    sheet: "Sheet1";
  };

  type FloExcelInspectInput = {
    path: string;
  };

  type FloExcelInspectOutput = {
    format: "xlsx";
    path: string;
    sheets: {
        columns: number;
        name: string;
        preview: FloJsonValue[][];
        preview_range: string;
        rows: number;
      }[];
  };

  type FloExcelReadInput = {
    path: string;
    range: string;
    sheet?: string;
  };

  type FloExcelReadOutput = {
    columns: number;
    format: "xlsx";
    path: string;
    range: string;
    rows: number;
    sheet: string;
    values: FloJsonValue[][];
  };

  type FloExcelCreateInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
    sheet?: string;
  };

  type FloExcelCreateOutput = {
    format: "xlsx";
    path: string;
    sheet?: string;
  };

  type FloExcelEditCellsInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
    sheet?: string;
  };

  type FloExcelEditCellsOutput = {
    format: "xlsx";
    path: string;
    sheet?: string;
  };

  type FloExcelEditStructureInput = {
    operations: ({
        count?: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
      })[];
    path: string;
    sheet?: string;
  };

  type FloExcelEditStructureOutput = {
    applied_count: number;
    applied_operations: ({
        column?: string;
        count: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
        sheet: string;
      })[];
    format: "xlsx";
    path: string;
    sheet: string;
  };

  type FloExcelAutoFitRowInput = {
    path: string;
    row: number;
    sheet?: string;
  };

  type FloExcelAutoFitRowOutput = {
    format: "xlsx";
    path: string;
    row: number;
    sheet: string;
  };

  type FloExcelApplyChangesInput = {
    assignments?: {
        cell: string;
        value?: FloJsonValue;
      }[];
    auto_fit_rows?: number[];
    operations?: ({
        count?: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
      })[];
    path: string;
    sheet?: string;
  };

  type FloExcelApplyChangesOutput = {
    applied_auto_fit_count: number;
    applied_auto_fit_rows: {
        row: number;
        sheet: string;
      }[];
    applied_count: number;
    applied_operations: ({
        column?: string;
        count: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
        sheet: string;
      })[];
    cell_assignment_count: number;
    format: "xlsx";
    path: string;
    sheets_touched: string[];
  };

  type FloMediaFetchInput = {
    media_id: string;
    output_path: string;
  };

  type FloMediaFetchOutput = {
    expires_at: string;
    media_id: string;
    media_type: string;
    output_path: string;
  };

  type FloMediaPushVfsInput = {
    filename?: string;
    input_path: string;
    ttl_seconds?: number;
  };

  type FloMediaPushVfsOutput = {
    expires_at: string;
    input_path: string;
    media_id: string;
    media_type: string;
    size_bytes: number;
  };

  type FloMediaPushBase64Input = {
    base64_data: string;
    filename?: string;
    media_type: string;
    ttl_seconds?: number;
  };

  type FloMediaPushBase64Output = {
    expires_at: string;
    filename?: string;
    media_id: string;
    media_type: string;
    size_bytes: number;
  };

  type FloSendNotificationInput = {
    channel_id?: string;
    channel_name?: string;
    message: {
      kind: "wecom";
    } & Record<string, FloJsonValue>;
  };

  type FloSendNotificationOutput = {
    channel_id: string;
    channel_name: string;
    delivered: boolean;
    kind: "wecom";
  };

  type FloSendMediaAttachmentInput = {
    filename?: string;
    media_id: string;
  };

  type FloSendMediaAttachmentOutput = {
    filename?: string;
    media_id: string;
    media_type: string;
    send_as_attachment: true;
    size_bytes: number;
  } | {
    download_url: string;
    filename?: string;
    media_id: string;
    media_type: string;
    send_as_attachment: false;
    size_bytes: number;
  };

  type FloSpawnChildrenInput = {
    children: ({
        input: FloJsonValue;
        objective: string;
        title: string;
        worker_kind: "extractor" | "matcher" | "classifier" | "summarizer" | "aggregator" | "verifier";
      })[];
    mode: "join_required" | "detached";
  };

  type FloSpawnChildrenOutput = {
    batch: {
      batch_id: string;
      child_count: number;
      mode: "join_required" | "detached";
    };
  };

  type FloAwaitBatchInput = {
    batch_id: string;
  };

  type FloAwaitBatchOutput = {
    all_terminal: boolean;
    batch: {};
    results: FloJsonValue[];
  };

  type FloReadSkillResourceInput = {
    destination_path?: string;
    mode: "text" | "import_to_vfs";
    resource_id: string;
    skill_id: string;
  };

  type FloReadSkillResourceOutput = {
    content: string;
    kind: "text";
    mime_type?: string;
    relative_path: string;
    resource_id: string;
    skill_id: string;
  } | {
    destination_path: string;
    kind: "text" | "blob";
    mime_type?: string;
    relative_path: string;
    resource_id: string;
    skill_id: string;
  };

  type FloImportSkillAssetInput = {
    asset_path: string;
    destination_path: string;
    skill_id: string;
  };

  type FloImportSkillAssetOutput = {
    asset_path: string;
    destination_path: string;
    skill_id: string;
  };

  interface FloBuiltinToolInputs {
    "list_available_skills": FloListAvailableSkillsInput;
    "read_text_file": FloReadTextFileInput;
    "write_text_file": FloWriteTextFileInput;
    "read_dir": FloReadDirInput;
    "zip": FloZipInput;
    "unzip": FloUnzipInput;
    "csv_inspect": FloCsvInspectInput;
    "csv_read": FloCsvReadInput;
    "csv_create": FloCsvCreateInput;
    "csv_edit_cells": FloCsvEditCellsInput;
    "excel_inspect": FloExcelInspectInput;
    "excel_read": FloExcelReadInput;
    "excel_create": FloExcelCreateInput;
    "excel_edit_cells": FloExcelEditCellsInput;
    "excel_edit_structure": FloExcelEditStructureInput;
    "excel_auto_fit_row": FloExcelAutoFitRowInput;
    "excel_apply_changes": FloExcelApplyChangesInput;
    "media_fetch": FloMediaFetchInput;
    "media_push_vfs": FloMediaPushVfsInput;
    "media_push_base64": FloMediaPushBase64Input;
    "send_notification": FloSendNotificationInput;
    "send_media_attachment": FloSendMediaAttachmentInput;
    "spawn_children": FloSpawnChildrenInput;
    "await_batch": FloAwaitBatchInput;
    "read_skill_resource": FloReadSkillResourceInput;
    "import_skill_asset": FloImportSkillAssetInput;
  }

  interface FloBuiltinToolOutputs {
    "list_available_skills": FloListAvailableSkillsOutput;
    "read_text_file": FloReadTextFileOutput;
    "write_text_file": FloWriteTextFileOutput;
    "read_dir": FloReadDirOutput;
    "zip": FloZipOutput;
    "unzip": FloUnzipOutput;
    "csv_inspect": FloCsvInspectOutput;
    "csv_read": FloCsvReadOutput;
    "csv_create": FloCsvCreateOutput;
    "csv_edit_cells": FloCsvEditCellsOutput;
    "excel_inspect": FloExcelInspectOutput;
    "excel_read": FloExcelReadOutput;
    "excel_create": FloExcelCreateOutput;
    "excel_edit_cells": FloExcelEditCellsOutput;
    "excel_edit_structure": FloExcelEditStructureOutput;
    "excel_auto_fit_row": FloExcelAutoFitRowOutput;
    "excel_apply_changes": FloExcelApplyChangesOutput;
    "media_fetch": FloMediaFetchOutput;
    "media_push_vfs": FloMediaPushVfsOutput;
    "media_push_base64": FloMediaPushBase64Output;
    "send_notification": FloSendNotificationOutput;
    "send_media_attachment": FloSendMediaAttachmentOutput;
    "spawn_children": FloSpawnChildrenOutput;
    "await_batch": FloAwaitBatchOutput;
    "read_skill_resource": FloReadSkillResourceOutput;
    "import_skill_asset": FloImportSkillAssetOutput;
  }

  interface FloRuntimeApi {
    sleep(ms: number): Promise<void>;
    time: {
      formatUnixTimestamp(timestamp: number, format: string, timezone?: string): string;
    };
    vault: {
      get(request: FloVaultRequest): Promise<string>;
    };
    state: {
      get<T = FloJsonValue>(request: FloStateGetRequest): Promise<FloStateEntry<T> | null>;
      list<T = FloJsonValue>(request: FloStateListRequest): Promise<FloStateListResult<T>>;
      put<T = FloJsonValue>(request: FloStatePutRequest<T>): Promise<FloStateWriteResult<T>>;
      delete(request: FloStateDeleteRequest): Promise<{ ok: boolean; conflict_revision?: string }>;
    };
    task: {
      emitEvent(request: FloTaskEmitEventRequest): Promise<void>;
      spawnChildren(request: FloSpawnChildrenRequest): Promise<FloSpawnChildrenResponse>;
      awaitBatch(request: FloAwaitBatchRequest): Promise<FloAwaitBatchResponse>;
    };
    callTool<TToolId extends FloBuiltinToolId>(
      request: { tool_id: TToolId; input: FloBuiltinToolInputs[TToolId] },
    ): Promise<FloToolCallResult<FloBuiltinToolOutputs[TToolId]>>;
    callTool<TOutput = unknown, TInput = unknown>(
      request: FloCallToolRequest<TInput>,
    ): Promise<FloToolCallResult<TOutput>>;
    browser: {
      run(
        command: FloBrowserCommand,
        options?: FloBrowserSessionOptions,
      ): Promise<FloBrowserCommandResult | FloJsonValue>;
      startRequestCapture(
        matchers: FloBrowserRequestCaptureMatcher[],
        options?: FloBrowserSessionOptions,
      ): Promise<{ current_url?: string | null; capture_id: string }>;
      collectCapturedRequests(
        capture_id: string,
        options?: FloBrowserSessionOptions & { timeout_ms?: number },
      ): Promise<{ current_url?: string | null; captures: FloBrowserRequestCaptureResult[] }>;
      stopRequestCapture(
        capture_id: string,
        options?: FloBrowserSessionOptions,
      ): Promise<{ current_url?: string | null; stopped: boolean }>;
      exportState(options?: FloBrowserSessionOptions): Promise<FloBrowserStorageState>;
      importState(
        state: FloBrowserStorageState,
        options?: FloBrowserSessionOptions,
      ): Promise<void>;
    };
  }

  export const sleep: FloRuntimeApi["sleep"];
  export const time: FloRuntimeApi["time"];
  export const vault: FloRuntimeApi["vault"];
  export const state: FloRuntimeApi["state"];
  export const task: FloRuntimeApi["task"];
  export const callTool: FloRuntimeApi["callTool"];
  export const browser: FloRuntimeApi["browser"];
}
