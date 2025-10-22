import type {
  TypstSourceDiagnostic,
  CompletionResponse,
  RenderResponse,
  TooltipResponse,
  DocumentClickResponseType,
  PreviewPosition,
} from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { type Result, ResultAsync } from "neverthrow";

type InvokeError = { message: string };
const invokeError = (e: unknown): InvokeError => {
  if (e instanceof Error) {
    return { message: e.message };
  }
  return { message: String(e) };
};

export async function render_pages(): Promise<
  Result<RenderResponse[], InvokeError>
> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<RenderResponse[]>,
    invokeError,
  );
  const result = await safeInvoke("render_pages", {});
  return result;
}

export async function render_page(
  page: number,
): Promise<Result<RenderResponse, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<RenderResponse>,
    invokeError,
  );
  const result = await safeInvoke("render_page", { page: page });
  return result;
}

export async function compile(): Promise<
  Result<TypstSourceDiagnostic[], InvokeError>
> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<TypstSourceDiagnostic[]>,
    invokeError,
  );
  const result = await safeInvoke("compile_main_file", {});
  return result;
}

export async function autocomplete(
  source_text: string,
  cursor_position: number,
  explicit: boolean,
): Promise<Result<CompletionResponse | null, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<CompletionResponse | null>,
    invokeError,
  );
  const result = await safeInvoke("autocomplete_at_position", {
    source_text,
    cursor_position,
    explicit,
  });
  return result;
}

export async function tooltip_info(
  source_text: string,
  cursor_position: number,
): Promise<Result<TooltipResponse | null, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<TooltipResponse | null>,
    invokeError,
  );
  const result = await safeInvoke("provide_hover_info", {
    source_text: source_text,
    cursor_position: cursor_position,
  });
  return result;
}

export async function page_click(
  source_text: string,
  page_number: number,
  x: number,
  y: number,
): Promise<Result<DocumentClickResponseType, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<DocumentClickResponseType>,
    invokeError,
  );
  const result = await safeInvoke("document_click_at_point", {
    source_text,
    page_number,
    x,
    y,
  });

  return result;
}

export async function open_workspace(
  path: string,
): Promise<Result<void, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(invoke<void>, invokeError);
  const result = await safeInvoke("open_workspace", { path });
  return result;
}

export async function update_file(
  path: string,
  source: string,
): Promise<Result<void, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(invoke<void>, invokeError);
  const result = await safeInvoke("update_file_source", {
    path,
    source,
  });
  return result;
}

type ExportOptions =
  | { format: "pdf" }
  | { format: "svg"; start_page: number; end_page: number; merged: boolean }
  | { format: "png"; start_page: number; end_page: number };
export async function export_main(
  export_path: string,
  options: ExportOptions,
): Promise<Result<void, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(invoke<void>, invokeError);

  const result = await safeInvoke("export_main_file", {
    export_path,
    format: options.format,
    start_page:
      options.format === "svg" || options.format === "png"
        ? options.start_page
        : undefined,
    end_page:
      options.format === "svg" || options.format === "png"
        ? options.end_page
        : undefined,
    merged: options.format === "svg" ? options.merged : false,
  });
  return result;
}

export async function set_main_file(
  path: string,
): Promise<Result<void, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(invoke<void>, invokeError);
  const result = await safeInvoke("set_main_file", {
    path,
  });
  return result;
}

export async function add_file(
  path: string,
  source: string,
): Promise<Result<void, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(invoke<void>, invokeError);
  const result = await safeInvoke("add_new_file", {
    path,
    source,
  });
  return result;
}

export async function get_cursor_position(
  cursor: number,
  source_text: string,
): Promise<Result<PreviewPosition, InvokeError>> {
  const safeInvoke = ResultAsync.fromThrowable(
    invoke<PreviewPosition>,
    invokeError,
  );
  const result = await safeInvoke("get_cursor_position_info", {
    cursor,
    source_text,
  });
  return result;
}
