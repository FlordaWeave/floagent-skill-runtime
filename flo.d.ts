type FloGlobalFetchHeaders = Record<string, string>;

declare class URLSearchParams implements Iterable<[string, string]> {
  constructor(
    init?:
      | string
      | Record<string, string | number | boolean>
      | Iterable<[string, string]>
      | URLSearchParams,
  );
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  forEach(
    callback: (value: string, key: string, parent: URLSearchParams) => void,
    thisArg?: unknown,
  ): void;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

declare class URL {
  constructor(input: string, base?: string | URL);
  href: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  readonly origin: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
  toJSON(): string;
}

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

declare function fetch(input: string | URL, init?: FloGlobalFetchInit): Promise<FloGlobalFetchResponse>;

declare module "flo:runtime" {
  type FloJsonValue =
    | null
    | boolean
    | number
    | string
    | FloJsonValue[]
    | { [key: string]: FloJsonValue };

  interface FloTaskResumePayload {
    batch_id?: string;
    [key: string]: FloJsonValue | undefined;
  }

  interface FloTaskContext {
    resume_payload?: FloTaskResumePayload;
    join_required_recovery?: FloJsonValue;
    script_child_batch_defer_recovery?: FloJsonValue;
    [key: string]: FloJsonValue | FloTaskResumePayload | undefined;
  }

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

  type FloStateScopeKind = "profile" | "session" | "task" | "shared";

  interface FloStateBindingRequestBase {
    scope_kind: FloStateScopeKind;
  }
  type FloStateGetRequest = FloStateBindingRequestBase & {
    key: string;
  };

  type FloStateListRequest = FloStateBindingRequestBase & {
    key_prefix: string;
    limit?: number;
    cursor?: string;
  };

  type FloStatePutRequest<T = FloJsonValue> = FloStateBindingRequestBase & {
    key: string;
    value: T;
    ttl_seconds?: number;
    if_revision?: string | null;
  };

  type FloStateDeleteRequest = FloStateBindingRequestBase & {
    key: string;
    if_revision?: string | null;
  };

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

  interface FloTaskGetToolStateRequest {
    key: string;
    tool_id?: string;
  }

  interface FloTaskPutToolStateRequest<T = FloJsonValue> {
    key: string;
    value: T;
    ttl_seconds?: number;
    if_revision?: string | null;
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

  interface FloGetBatchResultsRequest {
    batch_id: string;
  }

  interface FloWaitForBatchRequest {
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

  interface FloGetBatchResultsResponse {
    batch: FloChildBatch;
    results: FloChildResult[];
    all_terminal: boolean;
  }

  interface FloTaskLimits {
    readonly maxSpawnChildren: number;
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

  interface FloBrowserReloadCommand {
    type: "reload";
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

  type FloBrowserRequestCaptureResult = FloBrowserCapturedRequest;

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
    | FloBrowserReloadCommand
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
    /** Use this when the user asks what skills are available or what the agent can do. */
    | "list_available_skills"
    /** Read UTF-8 text content from a VFS file. Only VFS URIs are allowed, and files larger than 16384 bytes are rejected. Only use this tool if you are sure the file exists. Example input: {"path":"task://notes/summary.txt","max_bytes":4096}. */
    | "read_text_file"
    /** Write UTF-8 text content to a VFS file, creating parent directories as needed and overwriting any existing file. Only VFS URIs are allowed, and content larger than 65536 bytes is rejected. Example input: {"path":"task://notes/summary.txt","content":"hello world"}. */
    | "write_text_file"
    /** List the immediate files and directories under a VFS directory. Only VFS URIs are allowed. Example input: {"path":"task://artifacts"}. */
    | "read_dir"
    /** Create a ZIP archive from VFS files or directories. All input and output paths must be VFS URIs. Example input: {"input_paths":["task://report.txt","task://charts"],"output_path":"session://exports/report_bundle.zip"}. */
    | "zip"
    /** Extract a ZIP archive from a VFS file into a VFS directory. All input and output paths must be VFS URIs. Example input: {"input_path":"session://imports/source.zip","output_dir":"task://unzipped/source"}. */
    | "unzip"
    /** Inspect a CSV spreadsheet and return sheet dimensions plus a preview. Example input: {"path":"task://data/sales.csv"}. */
    | "csv_inspect"
    /** Read a CSV A1 range. Example input: {"path":"task://data/sales.csv","range":"A1:C5"}. */
    | "csv_read"
    /** Create a CSV file with initial cell assignments. Example input: {"path":"task://data/sales.csv","assignments":[{"cell":"A1","value":"Quarter"},{"cell":"B1","value":"Revenue"},{"cell":"A2","value":"Q1"},{"cell":"B2","value":12500}]}. */
    | "csv_create"
    /** Edit cells in an existing CSV file. Example input: {"path":"task://data/sales.csv","assignments":[{"cell":"B2","value":12800},{"cell":"C2","value":"updated"}]}. */
    | "csv_edit_cells"
    /** Inspect an XLSX workbook and return sheet dimensions plus previews. Example input: {"path":"task://spreadsheets/budget.xlsx"}. */
    | "excel_inspect"
    /** Read an XLSX A1 range. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","range":"A1:D8"}. */
    | "excel_read"
    /** Create an XLSX workbook with initial cell assignments. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","assignments":[{"cell":"A1","value":"Month"},{"cell":"B1","value":"Spend"},{"cell":"A2","value":"January"},{"cell":"B2","value":4200}]}. */
    | "excel_create"
    /** Edit cells in an existing XLSX workbook. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","assignments":[{"cell":"B2","value":4500},{"cell":"C2","value":"forecast"}]}. */
    | "excel_edit_cells"
    /** Copy XLSX cell style to matching target cells without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","source_cell":"B2","target_cells":["B3","B4","D2"]}. */
    | "excel_copy_cell_style"
    /** Clear XLSX cell style from target cells without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","cells":["B3","B4","Other!D2"]}. */
    | "excel_clear_cell_style"
    /** Copy XLSX row style, per-cell styles, merged cells, and row height to target rows without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","source_row":{"row":2},"target_rows":[{"row":3},{"row":4}]}. */
    | "excel_copy_row"
    /** Copy XLSX column style, per-cell styles, merged cells, and column width to target columns without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","source_column":{"column":"B"},"target_columns":[{"column":"C"},{"column":"D"}]}. */
    | "excel_copy_column"
    /** Insert or delete rows or columns in an XLSX workbook. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","operations":[{"kind":"insert_rows","index":3,"count":1},{"kind":"delete_columns","index":5,"count":1}]}. */
    | "excel_edit_structure"
    /** Increase an XLSX row height to fit wrapped content. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","row":4}. */
    | "excel_auto_fit_row"
    /** Atomically apply workbook structure edits, cell assignments, row copies, column copies, style copies, and row auto-fit in one XLSX save. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","operations":[{"kind":"insert_rows","index":3,"count":1}],"assignments":[{"cell":"A3","value":"February"},{"cell":"B3","value":3900}],"row_copies":[{"source_row":{"row":2},"target_rows":[{"row":3}]}],"style_copies":[{"source_cell":"B2","target_cells":["B3"]}],"auto_fit_rows":[3]}. */
    | "excel_apply_changes"
    /** Fetch remote media into the virtual workspace. Example input: {"media_id":"11111111-1111-1111-1111-111111111111","output_path":"session://imports/input.png"}. */
    | "media_fetch"
    /** Upload a VFS file to media storage. Example input: {"input_path":"task://artifacts/result.png","filename":"report.png","ttl_seconds":3600}. */
    | "media_push_vfs"
    /** Upload base64-encoded bytes to media storage. Example input: {"base64_data":"aGVsbG8=","media_type":"text/plain","filename":"hello.txt","ttl_seconds":3600}. */
    | "media_push_base64"
    /** Send a notification through an admin-configured notification channel. Provide exactly one of channel_name or channel_id. Prefer channel_name in authored skills; use channel_id for stricter programmatic callers. Supported msgtype values are text, markdown, markdown_v2, image, and file. */
    | "send_notification"
    /** Send previously uploaded media back to the current channel as a file attachment when it is smaller than 262144 bytes. Larger media returns a presigned download URL instead. Call media_push_vfs or media_push_base64 first, then pass the returned media_id here. Example input: {"media_id":"11111111-1111-1111-1111-111111111111","filename":"report.csv"}. */
    | "send_media_attachment"
    /** Read a text resource from a selected skill or import any skill resource into VFS by `skill_id` and `resource_id`. Use `resource_id` exactly as provided in the prompt (for example, `"resource.1"`). Do not strip prefixes, rewrite the value, or replace it with the filename. Valid example: `"resource_id":"resource.1"`. Invalid examples: `"resource_id":"1"` and `"resource_id":"guide.md"`. For text resources, prefer `mode=text` to read content directly. Use `mode=import_to_vfs` only when you need the resource saved as a VFS file for other tools or file-based processing, and provide `destination_path`. `destination_path` must be a VFS path such as `task://...` or `session://...`. Key takeaway: the `resource_id` is system-assigned and may differ from the actual file path. */
    | "read_skill_resource"
    /** Import a file from a selected skill into VFS by `skill_id` and author-relative `asset_path`. `skill_id` must match one of the selected skills. `asset_path` must stay relative to that skill's directory; absolute paths and `..` traversal are rejected. `destination_path` must be a VFS path such as `task://...` or `session://...`. */
    | "import_skill_asset";

  /** Input accepted by the `list_available_skills` runtime tool. */
  type FloListAvailableSkillsInput = {};

  /** Output returned by the `list_available_skills` runtime tool. */
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

  /** Input accepted by the `read_text_file` runtime tool. */
  type FloReadTextFileInput = {
    max_bytes?: number;
    path: string;
  };

  /** Output returned by the `read_text_file` runtime tool. */
  type FloReadTextFileOutput = {
    content: string;
    max_bytes: number;
    path: string;
    size_bytes: number;
  };

  /** Input accepted by the `write_text_file` runtime tool. */
  type FloWriteTextFileInput = {
    content: string;
    path: string;
  };

  /** Output returned by the `write_text_file` runtime tool. */
  type FloWriteTextFileOutput = {
    bytes_written: number;
    path: string;
  };

  /** Input accepted by the `read_dir` runtime tool. */
  type FloReadDirInput = {
    path: string;
  };

  /** Output returned by the `read_dir` runtime tool. */
  type FloReadDirOutput = {
    entries: ({
        entry_type: "directory" | "file";
        name: string;
        path: string;
      })[];
    entry_count: number;
    path: string;
  };

  /** Input accepted by the `zip` runtime tool. */
  type FloZipInput = {
    input_paths: string[];
    output_path: string;
  };

  /** Output returned by the `zip` runtime tool. */
  type FloZipOutput = {
    entry_count: number;
    input_paths: string[];
    output_path: string;
    size_bytes: number;
  };

  /** Input accepted by the `unzip` runtime tool. */
  type FloUnzipInput = {
    input_path: string;
    output_dir: string;
  };

  /** Output returned by the `unzip` runtime tool. */
  type FloUnzipOutput = {
    entry_count: number;
    input_path: string;
    output_dir: string;
    written_paths: string[];
  };

  /** Input accepted by the `csv_inspect` runtime tool. */
  type FloCsvInspectInput = {
    path: string;
  };

  /** Output returned by the `csv_inspect` runtime tool. */
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

  /** Input accepted by the `csv_read` runtime tool. */
  type FloCsvReadInput = {
    path: string;
    range: string;
  };

  /** Output returned by the `csv_read` runtime tool. */
  type FloCsvReadOutput = {
    columns: number;
    format: "csv";
    path: string;
    range: string;
    rows: number;
    sheet: string;
    values: FloJsonValue[][];
  };

  /** Input accepted by the `csv_create` runtime tool. */
  type FloCsvCreateInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
  };

  /** Output returned by the `csv_create` runtime tool. */
  type FloCsvCreateOutput = {
    format: "csv";
    path: string;
    sheet: "Sheet1";
  };

  /** Input accepted by the `csv_edit_cells` runtime tool. */
  type FloCsvEditCellsInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
  };

  /** Output returned by the `csv_edit_cells` runtime tool. */
  type FloCsvEditCellsOutput = {
    format: "csv";
    path: string;
    sheet: "Sheet1";
  };

  /** Input accepted by the `excel_inspect` runtime tool. */
  type FloExcelInspectInput = {
    path: string;
  };

  /** Output returned by the `excel_inspect` runtime tool. */
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

  /** Input accepted by the `excel_read` runtime tool. */
  type FloExcelReadInput = {
    path: string;
    range: string;
    sheet?: string;
  };

  /** Output returned by the `excel_read` runtime tool. */
  type FloExcelReadOutput = {
    columns: number;
    format: "xlsx";
    path: string;
    range: string;
    rows: number;
    sheet: string;
    values: FloJsonValue[][];
  };

  /** Input accepted by the `excel_create` runtime tool. */
  type FloExcelCreateInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
    sheet?: string;
  };

  /** Output returned by the `excel_create` runtime tool. */
  type FloExcelCreateOutput = {
    format: "xlsx";
    path: string;
    sheet?: string;
  };

  /** Input accepted by the `excel_edit_cells` runtime tool. */
  type FloExcelEditCellsInput = {
    assignments: {
        cell: string;
        value?: FloJsonValue;
      }[];
    path: string;
    sheet?: string;
  };

  /** Output returned by the `excel_edit_cells` runtime tool. */
  type FloExcelEditCellsOutput = {
    format: "xlsx";
    path: string;
    sheet?: string;
  };

  /** Input accepted by the `excel_copy_cell_style` runtime tool. */
  type FloExcelCopyCellStyleInput = {
    path: string;
    sheet?: string;
    source_cell?: string;
    target_cells?: string[];
  };

  /** Output returned by the `excel_copy_cell_style` runtime tool. */
  type FloExcelCopyCellStyleOutput = {
    applied_targets: {
        cell?: string;
        sheet: string;
      }[];
    copied_count: number;
    format: "xlsx";
    path: string;
    sheets_touched: string[];
    source_cell?: string;
  };

  /** Input accepted by the `excel_clear_cell_style` runtime tool. */
  type FloExcelClearCellStyleInput = {
    cells: string[];
    path: string;
    sheet?: string;
  };

  /** Output returned by the `excel_clear_cell_style` runtime tool. */
  type FloExcelClearCellStyleOutput = {
    cleared_count: number;
    cleared_targets: {
        cell: string;
        sheet: string;
      }[];
    format: "xlsx";
    path: string;
    sheets_touched: string[];
  };

  /** Input accepted by the `excel_copy_row` runtime tool. */
  type FloExcelCopyRowInput = {
    path: string;
    sheet?: string;
    source_row: {
      row: number;
      sheet?: string;
    };
    target_rows: {
        row: number;
        sheet?: string;
      }[];
  };

  /** Output returned by the `excel_copy_row` runtime tool. */
  type FloExcelCopyRowOutput = {
    applied_targets: {
        merge_ranges: string[];
        row: number;
        sheet: string;
      }[];
    copied_count: number;
    format: "xlsx";
    path: string;
    sheets_touched: string[];
    source_row: number;
  };

  /** Input accepted by the `excel_copy_column` runtime tool. */
  type FloExcelCopyColumnInput = {
    path: string;
    sheet?: string;
    source_column: {
      column: string;
      sheet?: string;
    };
    target_columns: {
        column: string;
        sheet?: string;
      }[];
  };

  /** Output returned by the `excel_copy_column` runtime tool. */
  type FloExcelCopyColumnOutput = {
    applied_targets: {
        column: string;
        merge_ranges: string[];
        sheet: string;
      }[];
    copied_count: number;
    format: "xlsx";
    path: string;
    sheets_touched: string[];
    source_column: string;
  };

  /** Input accepted by the `excel_edit_structure` runtime tool. */
  type FloExcelEditStructureInput = {
    operations: ({
        count?: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
      })[];
    path: string;
    sheet?: string;
  };

  /** Output returned by the `excel_edit_structure` runtime tool. */
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

  /** Input accepted by the `excel_auto_fit_row` runtime tool. */
  type FloExcelAutoFitRowInput = {
    path: string;
    row: number;
    sheet?: string;
  };

  /** Output returned by the `excel_auto_fit_row` runtime tool. */
  type FloExcelAutoFitRowOutput = {
    format: "xlsx";
    path: string;
    row: number;
    sheet: string;
  };

  /** Input accepted by the `excel_apply_changes` runtime tool. */
  type FloExcelApplyChangesInput = {
    assignments?: {
        cell: string;
        value?: FloJsonValue;
      }[];
    auto_fit_rows?: number[];
    column_copies?: {
        source_column: {
          column: string;
          sheet?: string;
        };
        target_columns: {
            column: string;
            sheet?: string;
          }[];
      }[];
    operations?: ({
        count?: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
      })[];
    path: string;
    row_copies?: {
        source_row: {
          row: number;
          sheet?: string;
        };
        target_rows: {
            row: number;
            sheet?: string;
          }[];
      }[];
    sheet?: string;
    style_copies?: {
        source_cell?: string;
        target_cells?: string[];
      }[];
  };

  /** Output returned by the `excel_apply_changes` runtime tool. */
  type FloExcelApplyChangesOutput = {
    applied_auto_fit_count: number;
    applied_auto_fit_rows: {
        row: number;
        sheet: string;
      }[];
    applied_column_copies: {
        source_column: string;
        targets: {
            column: string;
            merge_ranges: string[];
            sheet: string;
          }[];
      }[];
    applied_column_copy_count: number;
    applied_count: number;
    applied_operations: ({
        column?: string;
        count: number;
        index: number;
        kind: "insert_rows" | "delete_rows" | "insert_columns" | "delete_columns";
        sheet: string;
      })[];
    applied_row_copies: {
        source_row: number;
        targets: {
            merge_ranges: string[];
            row: number;
            sheet: string;
          }[];
      }[];
    applied_row_copy_count: number;
    applied_style_copies: {
        source_cell?: string;
        targets: {
            cell?: string;
            sheet: string;
          }[];
      }[];
    applied_style_copy_count: number;
    cell_assignment_count: number;
    format: "xlsx";
    path: string;
    sheets_touched: string[];
  };

  /** Input accepted by the `media_fetch` runtime tool. */
  type FloMediaFetchInput = {
    media_id: string;
    output_path: string;
  };

  /** Output returned by the `media_fetch` runtime tool. */
  type FloMediaFetchOutput = {
    expires_at: string;
    media_id: string;
    media_type: string;
    output_path: string;
  };

  /** Input accepted by the `media_push_vfs` runtime tool. */
  type FloMediaPushVfsInput = {
    filename?: string;
    input_path: string;
    ttl_seconds?: number;
  };

  /** Output returned by the `media_push_vfs` runtime tool. */
  type FloMediaPushVfsOutput = {
    expires_at: string;
    input_path: string;
    media_id: string;
    media_type: string;
    size_bytes: number;
  };

  /** Input accepted by the `media_push_base64` runtime tool. */
  type FloMediaPushBase64Input = {
    base64_data: string;
    filename?: string;
    media_type: string;
    ttl_seconds?: number;
  };

  /** Output returned by the `media_push_base64` runtime tool. */
  type FloMediaPushBase64Output = {
    expires_at: string;
    filename?: string;
    media_id: string;
    media_type: string;
    size_bytes: number;
  };

  /** Input accepted by the `send_notification` runtime tool. */
  type FloSendNotificationInput = {
    channel_id?: string;
    channel_name?: string;
    message: {
      kind: "wecom";
    } & Record<string, FloJsonValue>;
  };

  /** Output returned by the `send_notification` runtime tool. */
  type FloSendNotificationOutput = {
    channel_id: string;
    channel_name: string;
    delivered: boolean;
    kind: "wecom";
  };

  /** Input accepted by the `send_media_attachment` runtime tool. */
  type FloSendMediaAttachmentInput = {
    filename?: string;
    media_id: string;
  };

  /** Output returned by the `send_media_attachment` runtime tool. */
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

  /** Input accepted by the `read_skill_resource` runtime tool. */
  type FloReadSkillResourceInput = {
    destination_path?: string;
    mode: "text" | "import_to_vfs";
    resource_id: string;
    skill_id: string;
  };

  /** Output returned by the `read_skill_resource` runtime tool. */
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

  /** Input accepted by the `import_skill_asset` runtime tool. */
  type FloImportSkillAssetInput = {
    asset_path: string;
    destination_path: string;
    skill_id: string;
  };

  /** Output returned by the `import_skill_asset` runtime tool. */
  type FloImportSkillAssetOutput = {
    asset_path: string;
    destination_path: string;
    skill_id: string;
  };

  interface FloBuiltinToolInputs {
    /** Use this when the user asks what skills are available or what the agent can do. */
    "list_available_skills": FloListAvailableSkillsInput;
    /** Read UTF-8 text content from a VFS file. Only VFS URIs are allowed, and files larger than 16384 bytes are rejected. Only use this tool if you are sure the file exists. Example input: {"path":"task://notes/summary.txt","max_bytes":4096}. */
    "read_text_file": FloReadTextFileInput;
    /** Write UTF-8 text content to a VFS file, creating parent directories as needed and overwriting any existing file. Only VFS URIs are allowed, and content larger than 65536 bytes is rejected. Example input: {"path":"task://notes/summary.txt","content":"hello world"}. */
    "write_text_file": FloWriteTextFileInput;
    /** List the immediate files and directories under a VFS directory. Only VFS URIs are allowed. Example input: {"path":"task://artifacts"}. */
    "read_dir": FloReadDirInput;
    /** Create a ZIP archive from VFS files or directories. All input and output paths must be VFS URIs. Example input: {"input_paths":["task://report.txt","task://charts"],"output_path":"session://exports/report_bundle.zip"}. */
    "zip": FloZipInput;
    /** Extract a ZIP archive from a VFS file into a VFS directory. All input and output paths must be VFS URIs. Example input: {"input_path":"session://imports/source.zip","output_dir":"task://unzipped/source"}. */
    "unzip": FloUnzipInput;
    /** Inspect a CSV spreadsheet and return sheet dimensions plus a preview. Example input: {"path":"task://data/sales.csv"}. */
    "csv_inspect": FloCsvInspectInput;
    /** Read a CSV A1 range. Example input: {"path":"task://data/sales.csv","range":"A1:C5"}. */
    "csv_read": FloCsvReadInput;
    /** Create a CSV file with initial cell assignments. Example input: {"path":"task://data/sales.csv","assignments":[{"cell":"A1","value":"Quarter"},{"cell":"B1","value":"Revenue"},{"cell":"A2","value":"Q1"},{"cell":"B2","value":12500}]}. */
    "csv_create": FloCsvCreateInput;
    /** Edit cells in an existing CSV file. Example input: {"path":"task://data/sales.csv","assignments":[{"cell":"B2","value":12800},{"cell":"C2","value":"updated"}]}. */
    "csv_edit_cells": FloCsvEditCellsInput;
    /** Inspect an XLSX workbook and return sheet dimensions plus previews. Example input: {"path":"task://spreadsheets/budget.xlsx"}. */
    "excel_inspect": FloExcelInspectInput;
    /** Read an XLSX A1 range. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","range":"A1:D8"}. */
    "excel_read": FloExcelReadInput;
    /** Create an XLSX workbook with initial cell assignments. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","assignments":[{"cell":"A1","value":"Month"},{"cell":"B1","value":"Spend"},{"cell":"A2","value":"January"},{"cell":"B2","value":4200}]}. */
    "excel_create": FloExcelCreateInput;
    /** Edit cells in an existing XLSX workbook. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","assignments":[{"cell":"B2","value":4500},{"cell":"C2","value":"forecast"}]}. */
    "excel_edit_cells": FloExcelEditCellsInput;
    /** Copy XLSX cell style to matching target cells without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","source_cell":"B2","target_cells":["B3","B4","D2"]}. */
    "excel_copy_cell_style": FloExcelCopyCellStyleInput;
    /** Clear XLSX cell style from target cells without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","cells":["B3","B4","Other!D2"]}. */
    "excel_clear_cell_style": FloExcelClearCellStyleInput;
    /** Copy XLSX row style, per-cell styles, merged cells, and row height to target rows without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","source_row":{"row":2},"target_rows":[{"row":3},{"row":4}]}. */
    "excel_copy_row": FloExcelCopyRowInput;
    /** Copy XLSX column style, per-cell styles, merged cells, and column width to target columns without changing their values. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","source_column":{"column":"B"},"target_columns":[{"column":"C"},{"column":"D"}]}. */
    "excel_copy_column": FloExcelCopyColumnInput;
    /** Insert or delete rows or columns in an XLSX workbook. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","operations":[{"kind":"insert_rows","index":3,"count":1},{"kind":"delete_columns","index":5,"count":1}]}. */
    "excel_edit_structure": FloExcelEditStructureInput;
    /** Increase an XLSX row height to fit wrapped content. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","row":4}. */
    "excel_auto_fit_row": FloExcelAutoFitRowInput;
    /** Atomically apply workbook structure edits, cell assignments, row copies, column copies, style copies, and row auto-fit in one XLSX save. Example input: {"path":"task://spreadsheets/budget.xlsx","sheet":"Summary","operations":[{"kind":"insert_rows","index":3,"count":1}],"assignments":[{"cell":"A3","value":"February"},{"cell":"B3","value":3900}],"row_copies":[{"source_row":{"row":2},"target_rows":[{"row":3}]}],"style_copies":[{"source_cell":"B2","target_cells":["B3"]}],"auto_fit_rows":[3]}. */
    "excel_apply_changes": FloExcelApplyChangesInput;
    /** Fetch remote media into the virtual workspace. Example input: {"media_id":"11111111-1111-1111-1111-111111111111","output_path":"session://imports/input.png"}. */
    "media_fetch": FloMediaFetchInput;
    /** Upload a VFS file to media storage. Example input: {"input_path":"task://artifacts/result.png","filename":"report.png","ttl_seconds":3600}. */
    "media_push_vfs": FloMediaPushVfsInput;
    /** Upload base64-encoded bytes to media storage. Example input: {"base64_data":"aGVsbG8=","media_type":"text/plain","filename":"hello.txt","ttl_seconds":3600}. */
    "media_push_base64": FloMediaPushBase64Input;
    /** Send a notification through an admin-configured notification channel. Provide exactly one of channel_name or channel_id. Prefer channel_name in authored skills; use channel_id for stricter programmatic callers. Supported msgtype values are text, markdown, markdown_v2, image, and file. */
    "send_notification": FloSendNotificationInput;
    /** Send previously uploaded media back to the current channel as a file attachment when it is smaller than 262144 bytes. Larger media returns a presigned download URL instead. Call media_push_vfs or media_push_base64 first, then pass the returned media_id here. Example input: {"media_id":"11111111-1111-1111-1111-111111111111","filename":"report.csv"}. */
    "send_media_attachment": FloSendMediaAttachmentInput;
    /** Read a text resource from a selected skill or import any skill resource into VFS by `skill_id` and `resource_id`. Use `resource_id` exactly as provided in the prompt (for example, `"resource.1"`). Do not strip prefixes, rewrite the value, or replace it with the filename. Valid example: `"resource_id":"resource.1"`. Invalid examples: `"resource_id":"1"` and `"resource_id":"guide.md"`. For text resources, prefer `mode=text` to read content directly. Use `mode=import_to_vfs` only when you need the resource saved as a VFS file for other tools or file-based processing, and provide `destination_path`. `destination_path` must be a VFS path such as `task://...` or `session://...`. Key takeaway: the `resource_id` is system-assigned and may differ from the actual file path. */
    "read_skill_resource": FloReadSkillResourceInput;
    /** Import a file from a selected skill into VFS by `skill_id` and author-relative `asset_path`. `skill_id` must match one of the selected skills. `asset_path` must stay relative to that skill's directory; absolute paths and `..` traversal are rejected. `destination_path` must be a VFS path such as `task://...` or `session://...`. */
    "import_skill_asset": FloImportSkillAssetInput;
  }

  interface FloBuiltinToolOutputs {
    /** Output returned by the `list_available_skills` runtime tool. */
    "list_available_skills": FloListAvailableSkillsOutput;
    /** Output returned by the `read_text_file` runtime tool. */
    "read_text_file": FloReadTextFileOutput;
    /** Output returned by the `write_text_file` runtime tool. */
    "write_text_file": FloWriteTextFileOutput;
    /** Output returned by the `read_dir` runtime tool. */
    "read_dir": FloReadDirOutput;
    /** Output returned by the `zip` runtime tool. */
    "zip": FloZipOutput;
    /** Output returned by the `unzip` runtime tool. */
    "unzip": FloUnzipOutput;
    /** Output returned by the `csv_inspect` runtime tool. */
    "csv_inspect": FloCsvInspectOutput;
    /** Output returned by the `csv_read` runtime tool. */
    "csv_read": FloCsvReadOutput;
    /** Output returned by the `csv_create` runtime tool. */
    "csv_create": FloCsvCreateOutput;
    /** Output returned by the `csv_edit_cells` runtime tool. */
    "csv_edit_cells": FloCsvEditCellsOutput;
    /** Output returned by the `excel_inspect` runtime tool. */
    "excel_inspect": FloExcelInspectOutput;
    /** Output returned by the `excel_read` runtime tool. */
    "excel_read": FloExcelReadOutput;
    /** Output returned by the `excel_create` runtime tool. */
    "excel_create": FloExcelCreateOutput;
    /** Output returned by the `excel_edit_cells` runtime tool. */
    "excel_edit_cells": FloExcelEditCellsOutput;
    /** Output returned by the `excel_copy_cell_style` runtime tool. */
    "excel_copy_cell_style": FloExcelCopyCellStyleOutput;
    /** Output returned by the `excel_clear_cell_style` runtime tool. */
    "excel_clear_cell_style": FloExcelClearCellStyleOutput;
    /** Output returned by the `excel_copy_row` runtime tool. */
    "excel_copy_row": FloExcelCopyRowOutput;
    /** Output returned by the `excel_copy_column` runtime tool. */
    "excel_copy_column": FloExcelCopyColumnOutput;
    /** Output returned by the `excel_edit_structure` runtime tool. */
    "excel_edit_structure": FloExcelEditStructureOutput;
    /** Output returned by the `excel_auto_fit_row` runtime tool. */
    "excel_auto_fit_row": FloExcelAutoFitRowOutput;
    /** Output returned by the `excel_apply_changes` runtime tool. */
    "excel_apply_changes": FloExcelApplyChangesOutput;
    /** Output returned by the `media_fetch` runtime tool. */
    "media_fetch": FloMediaFetchOutput;
    /** Output returned by the `media_push_vfs` runtime tool. */
    "media_push_vfs": FloMediaPushVfsOutput;
    /** Output returned by the `media_push_base64` runtime tool. */
    "media_push_base64": FloMediaPushBase64Output;
    /** Output returned by the `send_notification` runtime tool. */
    "send_notification": FloSendNotificationOutput;
    /** Output returned by the `send_media_attachment` runtime tool. */
    "send_media_attachment": FloSendMediaAttachmentOutput;
    /** Output returned by the `read_skill_resource` runtime tool. */
    "read_skill_resource": FloReadSkillResourceOutput;
    /** Output returned by the `import_skill_asset` runtime tool. */
    "import_skill_asset": FloImportSkillAssetOutput;
  }

  interface FloRuntimeApi {
    /** Pause the script for the requested number of milliseconds. */
    sleep(ms: number): Promise<void>;
    time: {
      /** Format a Unix timestamp with the runtime's supported date format tokens. */
      formatUnixTimestamp(timestamp: number, format: string, timezone?: string): string;
    };
    /** Read secrets from the configured profile or shared vault scope. */
    vault: {
      /** Fetch a vault secret value. Secrets are never exposed through manifests. */
      get(request: FloVaultRequest): Promise<string>;
    };
    /** Read and write manifest-declared state bindings. */
    state: {
      /** Read one value from a state binding. */
      get<T = FloJsonValue>(request: FloStateGetRequest): Promise<FloStateEntry<T> | null>;
      /** List values under a state-binding key prefix. */
      list<T = FloJsonValue>(request: FloStateListRequest): Promise<FloStateListResult<T>>;
      /** Write one JSON-serializable value to a state binding. */
      put<T = FloJsonValue>(request: FloStatePutRequest<T>): Promise<FloStateWriteResult<T>>;
      /** Delete one value from a state binding. */
      delete(request: FloStateDeleteRequest): Promise<{ ok: boolean; conflict_revision?: string }>;
    };
    /** Access task context, task events, and child-task orchestration. */
    task: {
      /** Runtime limits for task orchestration helpers. */
      limits: FloTaskLimits;
      /** Read tool-partitioned convenience state from the current task. */
      getToolState<T = FloJsonValue>(request: FloTaskGetToolStateRequest): Promise<T | null>;
      /** Write tool-partitioned convenience state for the current tool in the current task. */
      putToolState<T = FloJsonValue>(
        request: FloTaskPutToolStateRequest<T>,
      ): Promise<FloStateWriteResult<T>>;
      /** Return the current durable task context, including resume payloads when present. */
      getContext<TContext = FloTaskContext>(): Promise<TContext>;
      /** Append a structured event to the current task timeline. */
      emitEvent(request: FloTaskEmitEventRequest): Promise<void>;
      /** Spawn durable child tasks for specialized parallel work. */
      spawnChildren(request: FloSpawnChildrenRequest): Promise<FloSpawnChildrenResponse>;
      /**
       * Suspend the parent task until the child batch is terminal, then return its results.
       *
       * The runtime re-enters the same script after resume; it does not preserve the JS stack.
       * Persist any script progress needed after resume with `putToolState` before calling this.
       */
      waitForBatch(
        request: FloWaitForBatchRequest,
      ): Promise<FloGetBatchResultsResponse>;
      /**
       * Return results for a terminal child batch.
       *
       * This fails non-retryably when the batch is still pending; scripts should call it only
       * after other control flow has established that `all_terminal` is true.
       */
      getBatchResults(request: FloGetBatchResultsRequest): Promise<FloGetBatchResultsResponse>;
    };
    /** Call a built-in or selected-skill tool through the runtime registry. */
    callTool<TToolId extends FloBuiltinToolId>(
      request: { tool_id: TToolId; input: FloBuiltinToolInputs[TToolId] },
    ): Promise<FloToolCallResult<FloBuiltinToolOutputs[TToolId]>>;
    /** Call a tool when only generic input/output types are known. */
    callTool<TOutput = unknown, TInput = unknown>(
      request: FloCallToolRequest<TInput>,
    ): Promise<FloToolCallResult<TOutput>>;
    /** Drive a host-managed Playwright browser session. */
    browser: {
      /** Run a single browser command in the current task browser session. */
      run(
        command: FloBrowserCommand,
        options?: FloBrowserSessionOptions,
      ): Promise<FloBrowserCommandResult | FloJsonValue>;
      /** Start capturing matching network requests for the browser session. */
      startRequestCapture(
        matchers: FloBrowserRequestCaptureMatcher[],
        options?: FloBrowserSessionOptions,
      ): Promise<{ current_url?: string | null; capture_id: string }>;
      /** Collect network requests captured for a capture id. */
      collectCapturedRequests(
        capture_id: string,
        options?: FloBrowserSessionOptions & { timeout_ms?: number },
      ): Promise<{ current_url?: string | null; captures: FloBrowserRequestCaptureResult[] }>;
      /** Stop a network request capture and release its runtime resources. */
      stopRequestCapture(
        capture_id: string,
        options?: FloBrowserSessionOptions,
      ): Promise<{ current_url?: string | null; stopped: boolean }>;
      /** Export browser storage state so the task can suspend and resume after handoff. */
      exportState(options?: FloBrowserSessionOptions): Promise<FloBrowserStorageState>;
      /** Import a previously exported browser storage state into the session. */
      importState(
        state: FloBrowserStorageState,
        options?: FloBrowserSessionOptions,
      ): Promise<void>;
    };
  }

  /** Pause the script for the requested number of milliseconds. */
  export const sleep: FloRuntimeApi["sleep"];
  /** Date and time helpers exposed by the Flo runtime. */
  export const time: FloRuntimeApi["time"];
  /** Vault secret helpers exposed by the Flo runtime. */
  export const vault: FloRuntimeApi["vault"];
  /** State binding helpers exposed by the Flo runtime. */
  export const state: FloRuntimeApi["state"];
  /** Durable task helpers exposed by the Flo runtime. */
  export const task: FloRuntimeApi["task"];
  /** Tool invocation helper exposed by the Flo runtime. */
  export const callTool: FloRuntimeApi["callTool"];
  /** Browser automation helpers exposed by the Flo runtime. */
  export const browser: FloRuntimeApi["browser"];
}
